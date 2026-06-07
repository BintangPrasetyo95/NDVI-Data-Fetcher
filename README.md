# 🛰️ NDVI Data Fetcher

> **ML-Ready NDVI satellite imagery on demand.** Draw a bounding box, pick a date range, and download FLOAT32 GeoTIFFs from Sentinel-2 — all through a secure backend proxy.

![Python](https://img.shields.io/badge/Python-3.11+-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.3+-61dafb?logo=react&logoColor=black)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9+-199900?logo=leaflet&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Architecture

```
┌─────────────────────────┐       ┌──────────────────────────┐       ┌───────────────────────┐
│   React Frontend        │       │   FastAPI Backend         │       │   Sentinel Hub API    │
│                         │       │                           │       │                       │
│  Leaflet Map + Draw     │──────▶│  POST /api/fetch-ndvi     │──────▶│  Process API v1       │
│  Control Panel          │ JSON  │  Token Manager (cached)   │ OAuth │  Sentinel-2 L2A       │
│  Download Handler       │◀──────│  Evalscript Engine        │◀──────│  GeoTIFF Response     │
│                         │ TIFF  │                           │ TIFF  │                       │
└─────────────────────────┘       └──────────────────────────┘       └───────────────────────┘
```

## Features

- 🗺️ **Interactive Map** — Draw rectangles on a dark-themed Leaflet map to define your area of interest
- 📡 **Sentinel-2 L2A** — Fetches from the latest Copernicus Sentinel-2 Level-2A archive
- 🧮 **ML-Ready NDVI** — FLOAT32 output with NaN masking for clouds, shadows, and water (via SCL band)
- 🔒 **Secure Proxy** — API credentials never leave the backend; OAuth2 tokens are cached and auto-refreshed
- 📥 **Direct Download** — GeoTIFF files download directly to your machine
- 🎨 **Premium UI** — Glassmorphism design with smooth animations and dark satellite theme

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** and **npm**
- **Sentinel Hub Account** — [Register here](https://www.sentinel-hub.com/) and create an OAuth client

## Quick Start

### 1. Clone & Configure

```bash
cd "NDVI Data Fetcher"

# Set up backend environment
cp backend/.env.example backend/.env
# Edit backend/.env with your Sentinel Hub credentials
```

### 2. Start the Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Check health at `http://localhost:8000/api/health`.

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will open at `http://localhost:5173` with automatic proxying to the backend.

### 4. Use the App

1. **Draw a rectangle** on the map to define your area of interest
2. **Set the date range** (defaults to the last 30 days)
3. **Adjust resolution** (default: 10 m/px, Sentinel-2's native resolution)
4. **Click "Fetch NDVI Data"** and wait for the GeoTIFF to download

## Troubleshooting & Common Confusions

### 1. `invalid_client` Authentication Error
- **Symptom:** Backend logs show `Status 401 - {"error":"invalid_client"}` or frontend shows `502 Bad Gateway`.
- **Cause:** Attempting to use Account IDs, User IDs, or standard API Keys. Sentinel Hub's modern Process API strictly requires OAuth2 Client Credentials.
- **Solution:** 
  1. Log into your Sentinel Hub Dashboard.
  2. Navigate to **User Settings** -> **OAuth Clients**.
  3. Create a client, and copy the generated **Client ID** and **Client Secret** (save the secret immediately!).
  4. Paste them into your `backend/.env` file.

### 2. Zero-Area Bounding Box Error (`422 Unprocessable Content`)
- **Symptom:** Logs show `West longitude must be less than East longitude` on `bbox` coordinates.
- **Cause:** Clicking once on the map without dragging, which registers a point (zero-area box).
- **Solution:** Ensure you **click, hold, drag, and release** to define a 2D rectangle. Point clicks are discarded to prevent server calculation errors.

### 3. Out-Of-Bounds Longitudes (`[-180, 180]` validation error)
- **Symptom:** Validation fails because coordinates look like `[-254.91, -4.93, -254.86, -4.90]`.
- **Cause:** Leaflet supports infinite panning, which can yield coordinates outside the standard range.
- **Solution:** The frontend now automatically normalizes/wraps coordinates (e.g. converting `-254.91` to `105.08`) before sending them to the API.

### 4. Interactive Gestures: Drag-and-Release
- **Symptom:** Moving the mouse draws the box but releasing it cancels, or dragging pans the map.
- **Solution:** We upgraded the map component to use a native **click-hold-drag-and-release** gesture. Click **Select Area** on the map, then hold and drag your cursor directly, and let go.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `SH_CLIENT_ID` | Sentinel Hub OAuth Client ID | ✅ |
| `SH_CLIENT_SECRET` | Sentinel Hub OAuth Client Secret | ✅ |
| `SH_INSTANCE_ID` | Sentinel Hub Configuration Instance ID | ❌ |

## API Reference

### `GET /api/health`

Health check endpoint.

**Response:**
```json
{ "status": "ok" }
```

### `POST /api/fetch-ndvi`

Fetch NDVI GeoTIFF for a given area and time range.

**Request Body:**
```json
{
  "bbox": [-122.5, 37.7, -122.3, 37.8],
  "date_from": "2025-06-01",
  "date_to": "2025-06-30",
  "resolution": 10.0
}
```

| Field | Type | Description | Default |
|---|---|---|---|
| `bbox` | `float[4]` | Bounding box `[west, south, east, north]` in EPSG:4326 | — |
| `date_from` | `string` | Start date (YYYY-MM-DD) | — |
| `date_to` | `string` | End date (YYYY-MM-DD) | — |
| `resolution` | `float` | Spatial resolution in meters/pixel | `10.0` |

**Response:** Binary `image/tiff` with `Content-Disposition: attachment` header.

## NDVI Evalscript

The evalscript computes the Normalized Difference Vegetation Index:

```
NDVI = (NIR - Red) / (NIR + Red) = (B08 - B04) / (B08 + B04)
```

**ML-Ready features:**
- **Output format:** Single-band FLOAT32 GeoTIFF
- **Valid range:** `[-1.0, 1.0]`
- **Invalid pixels:** `NaN` (not 0 or -9999)
- **Cloud masking:** Uses SCL (Scene Classification Layer) to mask clouds, shadows, water, and saturated pixels
- **Mosaicking:** Least cloud coverage prioritized

## Security Design

### OAuth2 Token Lifecycle

```
┌─────────────┐     Token valid?     ┌─────────────┐
│  API Request │────── Yes ──────────▶│  Use Cached  │
│              │                      │    Token     │
└──────┬───────┘                      └──────────────┘
       │ No (expired or < 60s remaining)
       ▼
┌──────────────┐     POST            ┌──────────────┐
│  Fetch New   │────────────────────▶│  Sentinel Hub │
│    Token     │◀────────────────────│  OAuth Server │
└──────┬───────┘     Access Token    └──────────────┘
       │
       ▼
┌──────────────┐
│ Cache Token  │
│ + Expiry     │
└──────────────┘
```

- Tokens are cached in-memory with expiry tracking
- Refresh happens automatically 60 seconds before expiry
- Thread-safe via `asyncio.Lock`
- Credentials never leave the backend process

### CORS Policy

In development, only `http://localhost:5173` is allowed. For production, update the allowed origins in `main.py`.

## Production Deployment Notes

1. **Replace CORS origins** with your production domain
2. **Use HTTPS** in production (terminate TLS at your reverse proxy)
3. **Add rate limiting** to prevent abuse of the Sentinel Hub API quota
4. **Consider Redis** for token caching in multi-worker deployments
5. **Set up monitoring** for token refresh failures and API errors

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + Vite | UI framework + bundler |
| Map | Leaflet + react-leaflet | Interactive mapping |
| Drawing | leaflet-draw + react-leaflet-draw | Bounding box selection |
| Backend | FastAPI + Uvicorn | Async API server |
| HTTP Client | httpx | Async HTTP requests to Sentinel Hub |
| Auth | OAuth2 Client Credentials | Sentinel Hub authentication |
| Data Format | GeoTIFF (FLOAT32) | ML-compatible raster output |

## License

MIT
