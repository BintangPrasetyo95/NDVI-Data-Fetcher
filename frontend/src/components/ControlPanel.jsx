import React from 'react';
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
}) {
  const formatCoord = (coord) => (coord ? coord.toFixed(4) : '');

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

      {/* Bounding Box Selection Status */}
      <div className="status-section">
        <div className="status-badge">
          <span className={`status-dot ${bbox ? 'active' : ''}`} />
          {bbox ? 'Area Selected' : 'Draw Area on Map'}
        </div>

        {bbox ? (
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
        ) : (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            Use the rectangle tool on the upper right side of the map to select a geographic region.
          </p>
        )}
      </div>

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
          <span>GeoTIFF download triggered successfully.</span>
        </div>
      )}

      {/* Action Trigger */}
      <button
        className="btn-fetch"
        disabled={!bbox || loading}
        onClick={onFetch}
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
