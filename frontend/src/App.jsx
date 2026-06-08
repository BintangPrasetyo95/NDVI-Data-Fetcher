import React, { useState } from 'react';
import { saveAs } from 'file-saver';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import StatsDashboard from './components/StatsDashboard';
import ForecastDashboard from './components/ForecastDashboard';
import LoadingOverlay from './components/LoadingOverlay';
import { fetchNDVI } from './api/ndvi';
import { parseNDVITiff } from './utils/ndviParser';

export default function App() {
  // Split Screen Sizing & Visibility States
  const [bottomHeight, setBottomHeight] = useState(400); // height in pixels
  const [isMinimized, setIsMinimized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (e) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'row-resize';
  };

  React.useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      // Calculate new height from client window height minus mouse Y coordinate
      const newHeight = window.innerHeight - e.clientY;
      // Clamp between 80px (minimized height) and 80% of window height
      if (newHeight >= 60 && newHeight <= window.innerHeight * 0.8) {
        setBottomHeight(newHeight);
        if (newHeight > 100) {
          setIsMinimized(false);
        } else {
          setIsMinimized(true);
        }
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const toggleMinimize = () => {
    if (isMinimized) {
      setBottomHeight(400);
      setIsMinimized(false);
    } else {
      setBottomHeight(60);
      setIsMinimized(true);
    }
  };

  // Helper to format Date objects as YYYY-MM-DD
  const formatDate = (date) => {
    return date.toISOString().split('T')[0];
  };

  // Get defaults (start date: 30 days ago, end date: today)
  const getInitialDates = () => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    return {
      to: formatDate(today),
      from: formatDate(thirtyDaysAgo)
    };
  };

  const initialDates = getInitialDates();

  // Component State
  const [bbox, setBbox] = useState(null);
  const [dateFrom, setDateFrom] = useState(initialDates.from);
  const [dateTo, setDateTo] = useState(initialDates.to);
  const [resolution, setResolution] = useState(10);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  // Stats and Overlay States
  const [stats, setStats] = useState(null);
  const [overlayUrl, setOverlayUrl] = useState(null);
  const [overlayBounds, setOverlayBounds] = useState(null);
  const [fitBounds, setFitBounds] = useState(null);

  // Callbacks for Map selection
  const handleBBoxCreated = (selectedBBox) => {
    setBbox(selectedBBox);
    setError(null);
    setSuccess(false);
    setStats(null);
    setOverlayUrl(null);
    setOverlayBounds(null);
  };

  const handleBBoxDeleted = () => {
    setBbox(null);
    setSuccess(false);
    setStats(null);
    setOverlayUrl(null);
    setOverlayBounds(null);
    setFitBounds(null);
    setShowForecast(false);
  };

  // Callback for Place Search Selection
  const handlePlaceSelect = (newBbox, leafletBounds) => {
    setBbox(newBbox);
    setFitBounds(leafletBounds);
    setError(null);
    setSuccess(false);
    setStats(null);
    setOverlayUrl(null);
    setOverlayBounds(null);

    // Auto-fetch NDVI for the newly searched place immediately!
    handleFetchNDVI(newBbox);
  };

  // Trigger Backend Proxy request to fetch GeoTIFF
  const handleFetchNDVI = async (targetBbox = bbox) => {
    const activeBbox = targetBbox || bbox;
    if (!activeBbox) {
      setError('Please draw a bounding box area on the map first or search a place.');
      return;
    }

    setLoading(true);
    setLoadingProgress(5);
    setError(null);
    setSuccess(false);
    setStats(null);
    setOverlayUrl(null);
    setOverlayBounds(null);

    // Simulate progress ticks
    const progressInterval = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.floor(Math.random() * 12) + 3;
      });
    }, 250);

    try {
      const response = await fetchNDVI({
        bbox: activeBbox,
        dateFrom,
        dateTo,
        resolution
      });

      const blob = await response.blob();
      const filename = `ndvi_${dateFrom}_to_${dateTo}.tiff`;

      // Download using file-saver (with native fallback)
      try {
        saveAs(blob, filename);
      } catch (fileSaverError) {
        // Fallback standard HTML anchor element download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        if (link.parentNode) {
          link.parentNode.removeChild(link);
        }
        window.URL.revokeObjectURL(url);
      }

      // Parse the GeoTIFF binary in the browser to compute stats and render image overlay
      const arrayBuffer = await blob.arrayBuffer();
      const parsedData = await parseNDVITiff(arrayBuffer);

      // Set visualization overlay and graphs data
      setOverlayUrl(parsedData.visualOverlayUrl);
      setOverlayBounds([[activeBbox[1], activeBbox[0]], [activeBbox[3], activeBbox[2]]]);
      setStats(parsedData.stats);
      setShowForecast(false);
      setSuccess(true);
      
      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 5000);

    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch NDVI imagery. Please try again.');
    } finally {
      clearInterval(progressInterval);
      setLoadingProgress(100);
      setTimeout(() => {
        setLoading(false);
        setLoadingProgress(0);
      }, 250);
    }
  };

  return (
    <div className="app-container">
      {/* 1. Leaflet Interactive map - occupies full background */}
      <MapView
        bbox={bbox}
        onBBoxCreated={handleBBoxCreated}
        onBBoxDeleted={handleBBoxDeleted}
        fitBounds={fitBounds}
        overlayUrl={overlayUrl}
        overlayBounds={overlayBounds}
      />

      {/* Resize handle bar */}
      <div 
        className={`resize-handle-bar ${isResizing ? 'active' : ''}`}
        style={{ bottom: `${bottomHeight}px` }}
        onMouseDown={startResize}
      >
        <div className="drag-handle-pill" />
        <button className="btn-minimize-toggle" onClick={toggleMinimize}>
          {isMinimized ? '▲ Expand Data Panel' : '▼ Minimize Panel'}
        </button>
      </div>

      {/* Bottom Half Container */}
      <div className="bottom-half-layout" style={{ height: `${bottomHeight}px` }}>
        {!isMinimized && (
          <>
            {/* Parameters Configuration panel */}
            <div className="bottom-column control-column">
              <ControlPanel
                bbox={bbox}
                dateFrom={dateFrom}
                setDateFrom={setDateFrom}
                dateTo={dateTo}
                setDateTo={setDateTo}
                resolution={resolution}
                setResolution={setResolution}
                loading={loading}
                error={error}
                setError={setError}
                success={success}
                setSuccess={setSuccess}
                onFetch={handleFetchNDVI}
                onPlaceSelect={handlePlaceSelect}
                onToggleForecast={() => {
                  setShowForecast(prev => {
                    if (!prev) setStats(null);
                    return !prev;
                  });
                }}
                showForecast={showForecast}
              />
            </div>

            {/* Dynamic Display panel for active analysis or forecast */}
            <div className="bottom-column dashboard-column">
              {!stats && !showForecast && (
                <div className="empty-state">
                  <span className="empty-icon">🛰️</span>
                  <h3>No Analysis Loaded</h3>
                  <p>Configure parameters on the left and fetch NDVI, or toggle the LSTM forecasting dashboard to compute vegetation trends.</p>
                </div>
              )}

              {/* Vegetation analysis dashboard displaying NDVI stats */}
              {stats && (
                <StatsDashboard
                  stats={stats}
                  onClose={() => setStats(null)}
                />
              )}

              {/* Forecasting LSTM dashboard */}
              {showForecast && bbox && (
                <ForecastDashboard
                  bbox={bbox}
                  onClose={() => setShowForecast(false)}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Full-screen loading overlay while fetching */}
      {loading && <LoadingOverlay progress={loadingProgress} />}
    </div>
  );
}

