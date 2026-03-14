import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Globe from "react-globe.gl";
import Plot from "react-plotly.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const INITIAL_FILTERS = { q: "", dateFrom: "", dateTo: "", station: "" };

const normalizeEvents = (rawEvents) => {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents.filter(
    (event) =>
      event &&
      typeof event.id !== "undefined" &&
      event.observed_at &&
      Array.isArray(event.velocity_km_s) &&
      Array.isArray(event.trajectory_points),
  );
};

const safeDateLabel = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "Unknown date" : dt.toISOString().split("T")[0];
};

const safeDateTimeLabel = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "Unknown" : dt.toLocaleString();
};

const deriveRangeFromEvents = (events, sourceRequested = "auto", sourceResolved = "auto") => {
  const dates = events
    .map((event) => safeDateLabel(event.observed_at))
    .filter((d) => d !== "Unknown date");

  if (dates.length === 0) {
    return {
      source_requested: sourceRequested,
      source_resolved: sourceResolved,
      event_count: events.length,
      min_date: null,
      max_date: null,
      latest_available_date: null,
    };
  }

  const sorted = [...dates].sort();
  return {
    source_requested: sourceRequested,
    source_resolved: sourceResolved,
    event_count: events.length,
    min_date: sorted[0],
    max_date: sorted[sorted.length - 1],
    latest_available_date: sorted[sorted.length - 1],
  };
};

function App() {
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [sourceMode, setSourceMode] = useState("auto");
  const [datasetRange, setDatasetRange] = useState(null);
  const [rangeWarning, setRangeWarning] = useState("");
  const [compareSummary, setCompareSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compareLoading, setCompareLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [error, setError] = useState("");

  const loadBundledRealData = async () => {
    const response = await fetch("/real_events.json");
    if (!response.ok) {
      throw new Error("Bundled real dataset not found.");
    }
    return normalizeEvents(await response.json());
  };

  useEffect(() => {
    const fetchDatasetRange = async () => {
      try {
        const response = await axios.get(`${API_BASE}/dataset-range`, {
          params: { source: sourceMode },
        });
        const range = response.data;
        setDatasetRange(range);
        if (range?.latest_available_date) {
          setFilters((prev) => {
            const latest = range.latest_available_date;
            const min = range.min_date;
            const outOfRange = prev.dateTo && ((min && prev.dateTo < min) || prev.dateTo > latest);
            if (!prev.dateTo || outOfRange) {
              return { ...prev, dateTo: latest };
            }
            return prev;
          });
        }
      } catch (rangeError) {
        setDatasetRange(null);
      }
    };

    fetchDatasetRange();
  }, [sourceMode]);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setError("");
        setLoading(true);
        const response = await axios.get(`${API_BASE}/events`, {
          params: {
            source: sourceMode,
            q: filters.q || undefined,
            date_from: filters.dateFrom || undefined,
            date_to: filters.dateTo || undefined,
            station: filters.station || undefined,
          },
        });

        const fetched = normalizeEvents(response.data);
        setEvents(fetched);

        if (fetched.length === 0) {
          setSelectedId(null);
          setCompareId(null);
          return;
        }

        const selectedStillExists = fetched.some((event) => event.id === selectedId);
        const compareStillExists = fetched.some((event) => event.id === compareId);
        const nextSelectedId = selectedStillExists ? selectedId : fetched[0].id;
        const nextCompareId = compareStillExists
          ? compareId
          : fetched.find((event) => event.id !== nextSelectedId)?.id ?? fetched[0].id;

        setSelectedId(nextSelectedId);
        setCompareId(nextCompareId);
      } catch (fetchError) {
        try {
          const bundledEvents = await loadBundledRealData();
          setEvents(bundledEvents);
          setDatasetRange(deriveRangeFromEvents(bundledEvents, sourceMode, "bundled_real"));
          setSelectedId(bundledEvents[0]?.id ?? null);
          setCompareId(
            bundledEvents.find((event) => event.id !== bundledEvents[0]?.id)?.id ??
              bundledEvents[0]?.id ??
              null,
          );
          const detail = fetchError?.response?.data?.detail;
          setError(
            detail
              ? `${detail} Using bundled real snapshot.`
              : "Backend unavailable. Using bundled real NASA snapshot.",
          );
        } catch (bundleError) {
          setEvents([]);
          const detail = fetchError?.response?.data?.detail;
          setError(
            detail ||
              "No data available from backend or bundled snapshot. Check setup and retry.",
          );
        }
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [filters.q, filters.dateFrom, filters.dateTo, filters.station, sourceMode]);

  useEffect(() => {
    if (!datasetRange?.min_date || !datasetRange?.max_date) {
      setRangeWarning("");
      return;
    }

    const warnings = [];
    const minDate = datasetRange.min_date;
    const maxDate = datasetRange.max_date;

    if (filters.dateFrom && filters.dateFrom < minDate) {
      warnings.push(`Date-from is before available data (${minDate}).`);
    }
    if (filters.dateFrom && filters.dateFrom > maxDate) {
      warnings.push(`Date-from is after latest available data (${maxDate}).`);
    }
    if (filters.dateTo && filters.dateTo < minDate) {
      warnings.push(`Date-to is before available data (${minDate}).`);
    }
    if (filters.dateTo && filters.dateTo > maxDate) {
      warnings.push(`Date-to is after latest available data (${maxDate}).`);
    }
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      warnings.push("Date-from must be earlier than date-to.");
    }

    setRangeWarning(warnings.join(" "));
  }, [filters.dateFrom, filters.dateTo, datasetRange]);

  useEffect(() => {
    const fetchCompareSummary = async () => {
      if (!selectedId || !compareId || selectedId === compareId) {
        setCompareSummary(null);
        return;
      }

      try {
        setCompareLoading(true);
        const response = await axios.get(`${API_BASE}/compare`, {
          params: {
            left: selectedId,
            right: compareId,
            source: sourceMode,
          },
        });
        setCompareSummary(response.data);
      } catch (compareError) {
        setCompareSummary(null);
      } finally {
        setCompareLoading(false);
      }
    };

    fetchCompareSummary();
  }, [selectedId, compareId, sourceMode]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) || null,
    [events, selectedId],
  );

  const compareEvent = useMemo(
    () => events.find((event) => event.id === compareId) || null,
    [events, compareId],
  );

  const arcData = useMemo(() => {
    if (!selectedEvent) return [];
    return [
      {
        startLat: selectedEvent.lat_start,
        startLng: selectedEvent.lon_start,
        endLat: selectedEvent.lat_end,
        endLng: selectedEvent.lon_end,
        color: "#ff6b6b",
      },
    ];
  }, [selectedEvent]);

  const pointData = useMemo(() => {
    if (!selectedEvent) return [];
    return selectedEvent.trajectory_points.map((point, index) => ({
      ...point,
      idx: index,
    }));
  }, [selectedEvent]);

  const velocityData = useMemo(() => {
    if (!selectedEvent) return [];
    const traces = [
      {
        x: selectedEvent.velocity_km_s.map((_, i) => i + 1),
        y: selectedEvent.velocity_km_s,
        type: "scatter",
        mode: "lines+markers",
        name: selectedEvent.name,
        line: { color: "#ff6b6b", width: 3 },
      },
    ];

    if (compareEvent && compareEvent.id !== selectedEvent.id) {
      traces.push({
        x: compareEvent.velocity_km_s.map((_, i) => i + 1),
        y: compareEvent.velocity_km_s,
        type: "scatter",
        mode: "lines+markers",
        name: compareEvent.name,
        line: { color: "#48dbfb", width: 3 },
      });
    }

    return traces;
  }, [selectedEvent, compareEvent]);

  const dashboardStats = useMemo(() => {
    const total = events.length;
    const allVelocities = events.flatMap((event) => event.velocity_km_s);
    const peak = allVelocities.length ? Math.max(...allVelocities) : 0;
    return { total, peak };
  }, [events]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      ...INITIAL_FILTERS,
      dateTo: datasetRange?.latest_available_date || "",
    });
    setError("");
    setRangeWarning("");
  };

  const syncRealData = async () => {
    try {
      setSyncLoading(true);
      setSyncMessage("");
      const response = await axios.post(`${API_BASE}/sync-real-events`, null, {
        params: { limit: 2000 },
      });
      setSyncMessage(`Synced ${response.data.saved_events} real events from NASA CNEOS.`);
      setSourceMode("real");
    } catch (syncError) {
      const detail = syncError?.response?.data?.detail;
      setSyncMessage(detail || "Real-data sync failed. Using bundled snapshot.");
      setSourceMode("auto");
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Meteor Trajectory Command Deck</h1>
        <p>Auto date-range detection + latest available date default enabled</p>
      </header>

      {loading && <div className="state-banner loading">Loading meteor events...</div>}
      {error && <div className="state-banner error">{error}</div>}
      {rangeWarning && <div className="state-banner warning">{rangeWarning}</div>}

      {!loading && (
        <section className="layout-grid">
          <aside className="card panel">
            <h2>Event Catalogue</h2>

            <label className="field-label" htmlFor="source-mode">
              Data Source
            </label>
            <select
              id="source-mode"
              value={sourceMode}
              onChange={(e) => setSourceMode(e.target.value)}
            >
              <option value="auto">Auto (Real if available)</option>
              <option value="real">Real NASA Data</option>
              <option value="mock">Mock Fallback</option>
            </select>

            <button className="sync-btn" onClick={syncRealData} disabled={syncLoading}>
              {syncLoading ? "Syncing..." : "Sync Real NASA Data"}
            </button>
            {syncMessage && <div className="sync-note">{syncMessage}</div>}

            {datasetRange?.min_date && datasetRange?.max_date && (
              <div className="range-note">
                Range: {datasetRange.min_date} to {datasetRange.max_date}
                <br />
                Latest available: {datasetRange.latest_available_date}
              </div>
            )}

            <input
              className="search-box"
              type="text"
              placeholder="Search event name..."
              value={filters.q}
              onChange={(e) => updateFilter("q", e.target.value)}
            />

            <label className="field-label" htmlFor="date-from">
              Date From
            </label>
            <input
              id="date-from"
              className="search-box"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
            />

            <label className="field-label" htmlFor="date-to">
              Date To
            </label>
            <input
              id="date-to"
              className="search-box"
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
            />

            <input
              className="search-box"
              type="text"
              placeholder="Filter by location/station..."
              value={filters.station}
              onChange={(e) => updateFilter("station", e.target.value)}
            />
            <button className="clear-btn" onClick={clearFilters}>
              Clear Filters
            </button>

            <div className="quick-stats">
              <div>
                <small>Visible Events</small>
                <strong>{dashboardStats.total}</strong>
              </div>
              <div>
                <small>Peak Velocity</small>
                <strong>{dashboardStats.peak.toFixed(1)} km/s</strong>
              </div>
            </div>

            <div className="event-list">
              {events.map((event) => (
                <button
                  key={event.id}
                  className={`event-btn ${selectedId === event.id ? "active" : ""}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <strong>{event.name}</strong>
                  <span>{safeDateLabel(event.observed_at)}</span>
                  <span>{event.station}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="card globe-wrap">
            <h2>3D Trajectory Visualizer</h2>
            <div className="globe-box">
              <Globe
                globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
                backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
                arcsData={arcData}
                arcColor={(d) => d.color}
                arcDashLength={0.55}
                arcDashGap={0.2}
                arcDashAnimateTime={1800}
                arcStroke={0.9}
                pointsData={pointData}
                pointLat="lat"
                pointLng="lon"
                pointAltitude={(d) => d.alt_km / 300}
                pointRadius={0.22}
                pointColor={() => "#ffe66d"}
                width={760}
                height={420}
              />
            </div>
          </section>

          <section className="card info-panel">
            <h2>Event Details</h2>
            {selectedEvent ? (
              <>
                <p>
                  <b>Name:</b> {selectedEvent.name}
                </p>
                <p>
                  <b>Observed:</b> {safeDateTimeLabel(selectedEvent.observed_at)}
                </p>
                <p>
                  <b>Source:</b> {selectedEvent.source || "unknown"}
                </p>
                <p>
                  <b>Station:</b> {selectedEvent.station}
                </p>
                <p>
                  <b>Start:</b> {selectedEvent.lat_start}, {selectedEvent.lon_start}
                </p>
                <p>
                  <b>End:</b> {selectedEvent.lat_end}, {selectedEvent.lon_end}
                </p>

                <label htmlFor="compare-select">
                  <b>Compare With:</b>
                </label>
                <select
                  id="compare-select"
                  value={compareId ?? ""}
                  onChange={(e) => setCompareId(Number(e.target.value))}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>

                {compareLoading && <p>Updating comparison...</p>}
                {!compareLoading && compareSummary && (
                  <div className="compare-summary">
                    <p>
                      <b>{compareSummary.left.name} avg:</b>{" "}
                      {compareSummary.left.avg_velocity_km_s} km/s
                    </p>
                    <p>
                      <b>{compareSummary.right.name} avg:</b>{" "}
                      {compareSummary.right.avg_velocity_km_s} km/s
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p>No events match your filters. Expand date range or clear filters.</p>
            )}
          </section>

          <section className="card chart-wrap">
            <h2>Velocity Profile (km/s)</h2>
            <Plot
              data={velocityData}
              layout={{
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#e6f1ff" },
                xaxis: { title: "Time Step", gridcolor: "#223047" },
                yaxis: { title: "Velocity (km/s)", gridcolor: "#223047" },
                margin: { t: 24, b: 50, l: 60, r: 24 },
                legend: { orientation: "h", y: 1.14 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "320px" }}
              useResizeHandler
            />
          </section>
        </section>
      )}
    </main>
  );
}

export default App;
