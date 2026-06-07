import React, { useState } from 'react';
import { saveAs } from 'file-saver';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import LoadingOverlay from './components/LoadingOverlay';
import { fetchNDVI } from './api/ndvi';

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

  // Callbacks for Map selection
  const handleBBoxCreated = (selectedBBox) => {
    setBbox(selectedBBox);
    setError(null);
    setSuccess(false);
  };

  const handleBBoxDeleted = () => {
    setBbox(null);
    setSuccess(false);
  };

  // Trigger Backend Proxy request to fetch GeoTIFF
  const handleFetchNDVI = async () => {
    if (!bbox) {
      setError('Please draw a bounding box area on the map first.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetchNDVI({
        bbox,
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
        onBBoxCreated={handleBBoxCreated}
        onBBoxDeleted={handleBBoxDeleted}
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
      />

      {/* 3. Full-screen loading overlay while fetching */}
      {loading && <LoadingOverlay />}
    </div>
  );
}
