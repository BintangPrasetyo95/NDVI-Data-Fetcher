import React, { useState } from 'react';
import { saveAs } from 'file-saver';
import { fetchAvailableDates, exportNDVITimeSeries } from '../api/ndvi';
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
  onToggleForecast,
  showForecast,
}) {
  const [activeTab, setActiveTab] = useState('search'); // 'search' or 'draw'
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // Scanner States
  const [availableDates, setAvailableDates] = useState([]);
  const [scanningDates, setScanningDates] = useState(false);
  const [maxCloudCover, setMaxCloudCover] = useState(20);
  const [selectedCatalogDate, setSelectedCatalogDate] = useState('');
  const [exportingZip, setExportingZip] = useState(false);

  const handleExportZIP = async () => {
    if (!bbox || availableDates.length === 0) return;
    setExportingZip(true);
    setError(null);
    try {
      const datesToExport = availableDates.slice(0, 20);
      const response = await exportNDVITimeSeries({
        bbox,
        dates: datesToExport,
        resolution
      });
      const blob = await response.blob();
      const filename = `ndvi_timeseries_${datesToExport[0]}_to_${datesToExport[datesToExport.length - 1]}.zip`;
      
      try {
        saveAs(blob, filename);
      } catch (fileSaverError) {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        if (link.parentNode) link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to export time-series stack.');
    } finally {
      setExportingZip(false);
    }
  };

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

  const handleScanDates = async () => {
    if (!bbox) {
      setError('Please select an area before scanning for dates.');
      return;
    }
    setScanningDates(true);
    setError(null);
    setAvailableDates([]);
    try {
      const res = await fetchAvailableDates({
        bbox,
        dateFrom,
        dateTo,
        maxCloudCover
      });
      if (res.dates && res.dates.length > 0) {
        setAvailableDates(res.dates);
        setSelectedCatalogDate(res.dates[0]);
        // Auto-select the first clean date
        setDateFrom(res.dates[0]);
        setDateTo(res.dates[0]);
      } else {
        setError('No clean images found with current cloud cover filter in this range.');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to scan available dates.');
    } finally {
      setScanningDates(false);
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
            onChange={(e) => {
              setDateFrom(e.target.value);
              setAvailableDates([]);
            }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="date-to">To</label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setAvailableDates([]);
            }}
          />
        </div>
      </div>

      {/* Clean Pass Scanner */}
      {bbox && (
        <div className="catalog-date-scanner" style={{ marginBottom: '16px' }}>
          <div className="scanner-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Clean Pass Scanner</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Max cloud:</span>
              <input 
                type="number" 
                min="0" 
                max="100" 
                value={maxCloudCover} 
                onChange={(e) => setMaxCloudCover(parseFloat(e.target.value) || 20)}
                style={{ width: '40px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-glass)', borderRadius: '4px', padding: '2px', color: 'var(--text-primary)', fontSize: '11px', textAlign: 'center' }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>%</span>
            </div>
          </div>
          <button
            className="btn-scan"
            onClick={handleScanDates}
            disabled={scanningDates}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              background: 'rgba(16, 185, 129, 0.1)',
              color: 'var(--accent-green-hover)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {scanningDates ? '⏳ Scanning Catalogue...' : '🔍 Scan for Cloud-Free Dates'}
          </button>

          {availableDates.length > 0 && (
            <div className="form-group" style={{ marginTop: '10px' }}>
              <label htmlFor="catalog-date-select" style={{ fontSize: '11px', marginBottom: '4px', display: 'block' }}>Select Clean Pass Date</label>
              <select
                id="catalog-date-select"
                value={selectedCatalogDate}
                onChange={(e) => {
                  const d = e.target.value;
                  setSelectedCatalogDate(d);
                  setDateFrom(d);
                  setDateTo(d);
                }}
                style={{
                  width: '100%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none'
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <p style={{ fontSize: '10px', color: 'var(--accent-green)', marginTop: '4px', lineHeight: '1.3', marginBottom: '8px' }}>
                ✓ Sets dates to download this specific cloud-free pass.
              </p>
              <button
                className="btn-export-zip"
                onClick={handleExportZIP}
                disabled={exportingZip}
                style={{
                  width: '100%',
                  marginTop: '10px',
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--accent-purple), #7c3aed)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px var(--accent-purple-glow)',
                  transition: 'all 0.25s ease'
                }}
              >
                <span>📦</span>
                {exportingZip ? 'Compiling ZIP...' : `Export Time-Series Stack (${availableDates.length} TIFFs)`}
              </button>
            </div>
          )}
        </div>
      )}

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

      {/* Action Trigger Buttons */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          className="btn-fetch"
          disabled={!bbox || loading}
          onClick={() => onFetch()}
          style={{ flex: 1 }}
        >
          <span>📡</span>
          {loading ? 'Processing...' : 'Fetch NDVI'}
        </button>

        <button
          className="btn-forecast-toggle"
          disabled={!bbox || loading}
          onClick={onToggleForecast}
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: showForecast 
              ? 'rgba(139, 92, 246, 0.4)' 
              : 'linear-gradient(135deg, var(--accent-purple), #7c3aed)',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: showForecast 
              ? '0 0 12px var(--accent-purple-glow)' 
              : '0 4px 12px var(--accent-purple-glow)',
            transition: 'all 0.25s ease'
          }}
        >
          <span>🔮</span>
          {showForecast ? 'Close Forecast' : 'Forecast NDVI'}
        </button>
      </div>

      <div className="panel-footer">
        Powered by Sentinel Hub &bull; Sentinel-2 L2A
      </div>
    </div>
  );
}

