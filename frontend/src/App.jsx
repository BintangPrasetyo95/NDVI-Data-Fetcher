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
    setError(null);
    setSuccess(false);
    setStats(null);
    setOverlayUrl(null);
    setOverlayBounds(null);

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
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* 1. Leaflet Interactive map covering whole viewport */}
      <MapView
        bbox={bbox}
        onBBoxCreated={handleBBoxCreated}
        onBBoxDeleted={handleBBoxDeleted}
        fitBounds={fitBounds}
        overlayUrl={overlayUrl}
        overlayBounds={overlayBounds}
      />

      {/* 2. Parameters Configuration Floating panel */}
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

      {/* 3. Vegetation analysis dashboard displaying NDVI stats and frequency graph */}
      {stats && (
        <StatsDashboard
          stats={stats}
          onClose={() => setStats(null)}
        />
      )}

      {/* 4. Forecasting LSTM dashboard (collapsible bottom panel) */}
      {showForecast && bbox && (
        <ForecastDashboard
          bbox={bbox}
          onClose={() => setShowForecast(false)}
        />
      )}

      {/* 5. Full-screen loading overlay while fetching */}
      {loading && <LoadingOverlay />}
    </div>
  );
}

