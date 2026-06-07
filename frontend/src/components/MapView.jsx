import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMapEvents, Rectangle, ImageOverlay, useMap } from 'react-leaflet';
import L from 'leaflet';
import './MapView.css';

// Custom Map Controller to programmatically change map bounds
function MapViewController({ fitBounds }) {
  const map = useMap();
  useEffect(() => {
    if (fitBounds) {
      map.fitBounds(fitBounds, {
        padding: [40, 40],
        maxZoom: 12,
        animate: true,
        duration: 1.2,
      });
    }
  }, [fitBounds, map]);
  return null;
}

// Custom Map Component to handle click-hold-drag-release drawing
function DragSelectHandler({ active, setActive, onBBoxCreated, currentRectRef }) {
  const map = useMapEvents({
    mousedown(e) {
      if (!active) return;

      // Disable map panning and zooming during drawing
      map.dragging.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();

      // Clear any existing rectangle
      if (currentRectRef.current && currentRectRef.current.rect) {
        currentRectRef.current.rect.remove();
      }

      // Initialize the drawing rectangle (temporary visual layer)
      const rect = L.rectangle([e.latlng, e.latlng], {
        color: '#10b981',
        weight: 2,
        fillOpacity: 0.15,
        dashArray: '10 5',
      }).addTo(map);

      currentRectRef.current = {
        rect: rect,
        startLatLng: e.latlng,
        isDrawing: true,
      };
    },
    mousemove(e) {
      if (!active || !currentRectRef.current || !currentRectRef.current.isDrawing) return;

      const { rect, startLatLng } = currentRectRef.current;
      rect.setBounds([startLatLng, e.latlng]);
    },
    mouseup(e) {
      // Re-enable map controls
      map.dragging.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();

      if (!active || !currentRectRef.current || !currentRectRef.current.isDrawing) return;

      const { rect } = currentRectRef.current;
      currentRectRef.current.isDrawing = false;

      const bounds = rect.getBounds();
      
      // Normalize longitudes to the [-180, 180] range to support map wrap-around panning
      const wrapLng = (lng) => ((lng + 180) % 360 + 360) % 360 - 180;
      
      let west = wrapLng(bounds.getWest());
      let east = wrapLng(bounds.getEast());
      const south = bounds.getSouth();
      const north = bounds.getNorth();

      // Ensure west is less than east after wrapping
      if (west > east) {
        const temp = west;
        west = east;
        east = temp;
      }

      // Check if the area is meaningful (prevent tiny clicks/dots)
      const latDiff = Math.abs(north - south);
      const lngDiff = Math.abs(east - west);

      if (latDiff > 0.0001 && lngDiff > 0.0001) {
        onBBoxCreated([west, south, east, north]);
        setActive(false); // Turn off draw mode after successful draw
      }

      // Remove the temporary drawing rectangle; React will render the official bounding box
      rect.remove();
      currentRectRef.current = null;
    },
  });

  // Dynamic cursor updates depending on state
  useEffect(() => {
    const container = map.getContainer();
    if (active) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = '';
    }
  }, [active, map]);

  return null;
}

export default function MapView({
  bbox,
  onBBoxCreated,
  onBBoxDeleted,
  fitBounds,
  overlayUrl,
  overlayBounds,
}) {
  const [drawActive, setDrawActive] = useState(false);
  const currentRectRef = useRef(null);
  const mapRef = useRef(null);

  // Clear current active selection
  const handleClear = () => {
    if (currentRectRef.current && currentRectRef.current.rect) {
      currentRectRef.current.rect.remove();
      currentRectRef.current = null;
    }
    setDrawActive(false);
    onBBoxDeleted();
  };

  return (
    <div className="map-container">
      <MapContainer
        center={[-2.5, 118.0]} // Indonesia Center
        zoom={5} // Zoom level 5 fits whole Indonesia beautifully
        zoomControl={false}
        ref={mapRef}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          className="dark-tiles"
        />

        <DragSelectHandler
          active={drawActive}
          setActive={setDrawActive}
          onBBoxCreated={onBBoxCreated}
          currentRectRef={currentRectRef}
        />

        {/* Declarative Bounding Box Rectangle */}
        {bbox && (
          <Rectangle
            bounds={[[bbox[1], bbox[0]], [bbox[3], bbox[2]]]}
            pathOptions={{
              color: '#10b981',
              weight: 2,
              fillOpacity: overlayUrl ? 0.0 : 0.1, // transparent if we have overlay
              dashArray: '10 5',
            }}
          />
        )}

        {/* Declarative NDVI Raster Overlay Layer */}
        {overlayUrl && overlayBounds && (
          <ImageOverlay
            url={overlayUrl}
            bounds={overlayBounds}
            opacity={0.8}
          />
        )}

        {/* Dynamic Zoom/Bounds controller */}
        <MapViewController fitBounds={fitBounds} />

        <ZoomControl position="topright" />
      </MapContainer>

      {/* Floating Drawing Controller Toolbar */}
      <div className="custom-draw-toolbar">
        <button
          className={`toolbar-btn ${drawActive ? 'active' : ''}`}
          onClick={() => setDrawActive(!drawActive)}
          title="Click to activate drag-to-select"
        >
          {drawActive ? '⏹️ Cancel Drawing' : '🟩 Select Area'}
        </button>
        {bbox && (
          <button className="toolbar-btn clear-btn" onClick={handleClear}>
            🗑️ Clear Area
          </button>
        )}
      </div>
    </div>
  );
}

