import React from 'react';
import './LoadingOverlay.css';

export default function LoadingOverlay() {
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="satellite-loader">
          <div className="orbit">
            <span className="satellite-element">🛰️</span>
          </div>
          <span className="earth-element">🌍</span>
        </div>
        <div className="loading-text">
          <h2>Processing Satellite Imagery</h2>
          <p>Requesting high-resolution NDVI GeoTIFF from Sentinel Hub...</p>
          <div className="progress-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
