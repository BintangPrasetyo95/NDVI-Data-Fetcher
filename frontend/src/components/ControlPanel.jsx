import React, { useState } from 'react';
import './ControlPanel.css';

export default function ControlPanel({
  bbox,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  resolution,
  setResolution,
  loading,
  error,
  setError,
  success,
  setSuccess,
  onFetch,
  onPlaceSelect,
}) {
  const [activeTab, setActiveTab] = useState('search'); // 'search' or 'draw'
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const formatCoord = (coord) => (coord ? coord.toFixed(4) : '');

  const triggerSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    setSuggestions([]);
    try {
      // First try searching with Indonesia country bias
      let response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=id&limit=5`
      );
      if (!response.ok) throw new Error('Search failed');
      let data = await response.json();
      
      // If no results in Indonesia, search globally
      if (data.length === 0) {
        response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`
        );
        if (!response.ok) throw new Error('Global search failed');
        data = await response.json();
      }

      if (data.length === 0) {
        setError('No locations found. Try being more specific, e.g. "Kabupaten Bandung".');
      } else {
        setSuggestions(data);
      }
    } catch (err) {
      console.error(err);
      setError('Geocoding search failed. Please check your internet connection.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSuggestion = (item) => {
    const bboxStr = item.boundingbox;
    if (bboxStr && bboxStr.length === 4) {
      const south = parseFloat(bboxStr[0]);
      const north = parseFloat(bboxStr[1]);
      const west = parseFloat(bboxStr[2]);
      const east = parseFloat(bboxStr[3]);
      
      const newBbox = [west, south, east, north];
      
      // Clear suggestions and update search query to selected place name
      setSuggestions([]);
      setSearchQuery(item.display_name.split(',')[0]);
      
      // Call parent select callback
      onPlaceSelect(newBbox, [[south, west], [north, east]]);
    }
  };

  return (
    <div className="control-panel">
      <div className="panel-header">
        <span className="panel-icon">🛰️</span>
        <div className="panel-title-group">
          <h1>NDVI Data Fetcher</h1>
          <p>ML-Ready Satellite Imagery</p>
        </div>
      </div>

      <div className="divider" />

      {/* Mode Tabs */}
      <div className="panel-tabs">
        <button
          className={`panel-tab ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          🔍 Search Place
        </button>
        <button
          className={`panel-tab ${activeTab === 'draw' ? 'active' : ''}`}
          onClick={() => setActiveTab('draw')}
        >
          ✏️ Draw Area
        </button>
      </div>

      {/* Search Tab Content */}
      {activeTab === 'search' && (
        <div className="search-container">
          <label htmlFor="place-search">Search Location (Kabupaten, Kota, etc.)</label>
          <div className="search-group">
            <div className="search-input-wrapper">
              <input
                id="place-search"
                type="text"
                placeholder="e.g., Kabupaten Bogor, Bandung..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') triggerSearch();
                }}
              />
            </div>
            <button
              className="btn-search"
              onClick={triggerSearch}
              disabled={searching}
              title="Search place"
            >
              {searching ? '⏳' : 'Search'}
            </button>
          </div>

          {/* Search suggestions dropdown */}
          {suggestions.length > 0 && (
            <ul className="search-suggestions">
              {suggestions.map((item) => (
                <li
                  key={item.place_id}
                  className="suggestion-item"
                  onClick={() => handleSelectSuggestion(item)}
                >
                  {item.display_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Draw Tab Content */}
      {activeTab === 'draw' && (
        <div className="status-section">
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            Click the <strong style={{ color: 'var(--accent-green)' }}>🟩 Select Area</strong> button on the map, then hold, drag, and release to select a bounding box region.
          </p>
        </div>
      )}

      {/* Bounding Box Selection Status (Common for both) */}
      <div className="status-section">
        <div className="status-badge">
          <span className={`status-dot ${bbox ? 'active' : ''}`} />
          {bbox ? 'Area Selected' : 'No Area Selected'}
        </div>

        {bbox && (
          <div className="bbox-coords">
            <div>
              <span className="coord-label">W:</span> {formatCoord(bbox[0])}
            </div>
            <div>
              <span className="coord-label">S:</span> {formatCoord(bbox[1])}
            </div>
            <div>
              <span className="coord-label">E:</span> {formatCoord(bbox[2])}
            </div>
            <div>
              <span className="coord-label">N:</span> {formatCoord(bbox[3])}
            </div>
          </div>
        )}
      </div>

      <div className="divider" />

      {/* Dates Selection */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="date-from">From</label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="date-to">To</label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {/* Resolution Input */}
      <div className="form-group">
        <label htmlFor="resolution">Spatial Resolution</label>
        <div className="resolution-input-wrapper">
          <input
            id="resolution"
            type="number"
            min="1"
            max="500"
            step="1"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <span className="input-unit">m/px</span>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert alert-danger">
          <button className="alert-close" onClick={() => setError(null)}>&times;</button>
          <strong>API Error</strong>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <button className="alert-close" onClick={() => setSuccess(false)}>&times;</button>
          <strong>Success</strong>
          <span>Data fetched and visualization generated!</span>
        </div>
      )}

      {/* Action Trigger */}
      <button
        className="btn-fetch"
        disabled={!bbox || loading}
        onClick={() => onFetch()}
      >
        <span>📡</span>
        {loading ? 'Processing Imagery...' : 'Fetch NDVI Data'}
      </button>

      <div className="panel-footer">
        Powered by Sentinel Hub &bull; Sentinel-2 L2A
      </div>
    </div>
  );
}

