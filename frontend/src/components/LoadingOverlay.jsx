import React from 'react';
import './LoadingOverlay.css';

export default function LoadingOverlay({ progress }) {
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
          
          {progress !== undefined && progress !== null && (
            <div className="loading-progress-container" style={{ marginTop: '20px', width: '100%', minWidth: '280px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '8px' }}>
                <span>Downloading Imagery Tiles</span>
                <span style={{ fontWeight: '700', color: 'var(--accent-green-hover)' }}>{progress}%</span>
              </div>
              <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    width: `${progress}%`, 
                    height: '100%', 
                    background: 'linear-gradient(90deg, var(--accent-green), #059669)', 
                    borderRadius: '9999px', 
                    transition: 'width 0.2s ease',
                    boxShadow: '0 0 8px rgba(16, 185, 129, 0.4)'
                  }} 
                />
              </div>
            </div>
          )}

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
