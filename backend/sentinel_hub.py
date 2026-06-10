import os
import math
import time
import logging
import asyncio
from typing import List, Optional
import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ML-Ready NDVI Evalscript: calculates NDVI, masks clouds/shadows/water using SCL, outputs FLOAT32 with NaN
NDVI_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "SCL"],
      units: "DN"
    }],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {
  // Scene Classification Layer (SCL) values:
  // 0: NO_DATA, 1: SATURATED_OR_DEFECTIVE, 2: DARK_AREA_PIXELS, 3: CLOUD_SHADOWS,
  // 4: VEGETATION, 5: NOT_VEGETATED, 6: WATER, 7: UNCLASSIFIED, 
  // 8: CLOUD_MEDIUM_PROBABILITY, 9: CLOUD_HIGH_PROBABILITY, 10: THIN_CIRRUS, 11: SNOW_OR_ICE
  let invalidSCL = [0, 1, 3, 8, 9, 10];
  if (invalidSCL.includes(sample.SCL)) {
    return [NaN];
  }
  
  let nir = sample.B08;
  let red = sample.B04;
  
  if ((nir + red) === 0) {
    return [NaN];
  }
  
  return [(nir - red) / (nir + red)];
}
"""

class TokenManager:
    """
    Thread-safe Singleton Token Manager for Sentinel Hub API.
    Caches the OAuth2 token in memory and handles lazy refresh.
    """
    _instance: Optional["TokenManager"] = None
    _lock = asyncio.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TokenManager, cls).__new__(cls)
            cls._instance._token = None
            cls._instance._expiry_time = 0.0
            cls._instance._token_lock = asyncio.Lock()
        return cls._instance

    async def get_token(self) -> str:
        async with self._token_lock:
            # Check if token exists and is valid (not expiring in the next 60 seconds)
            if self._token and time.time() < (self._expiry_time - 60):
                return self._token

            logger.info("Sentinel Hub OAuth token expired or not set. Requesting new token...")
            client_id = os.getenv("SH_CLIENT_ID")
            client_secret = os.getenv("SH_CLIENT_SECRET")

            if not client_id or not client_secret:
                raise ValueError("SH_CLIENT_ID and SH_CLIENT_SECRET environment variables must be set.")

            url = "https://services.sentinel-hub.com/oauth/token"
            data = {"grant_type": "client_credentials"}
            headers = {"content-type": "application/x-www-form-urlencoded"}

            async with httpx.AsyncClient(timeout=15.0) as client:
                try:
                    response = await client.post(
                        url,
                        data=data,
                        auth=(client_id, client_secret),
                        headers=headers
                    )
                    response.raise_for_status()
                    res_json = response.json()
                    
                    self._token = res_json["access_token"]
                    # Store absolute expiration timestamp
                    expires_in = float(res_json.get("expires_in", 3600))
                    self._expiry_time = time.time() + expires_in
                    
                    logger.info("Successfully fetched and cached new Sentinel Hub OAuth token.")
                    return self._token
                except httpx.HTTPStatusError as e:
                    logger.error(f"Failed to fetch OAuth token: Status {e.response.status_code} - {e.response.text}")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Sentinel Hub authentication failed: {e.response.text}"
                    )
                except Exception as e:
                    logger.error(f"Unexpected error during Sentinel Hub authentication: {str(e)}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Sentinel Hub connection error: {str(e)}"
                    )

token_manager = TokenManager()

async def fetch_ndvi_tiff(
    bbox: List[float],
    date_from: str,
    date_to: str,
    resolution: float = 10.0
) -> bytes:
    """
    Fetches NDVI GeoTIFF binary data from Sentinel Hub Process API.
    """
    # Shrink bbox to fit within safe limits if it is too large
    bbox = limit_bbox_size(bbox, max_size_m=100000.0)

    # 1. Get Access Token
    token = await token_manager.get_token()

    # 2. Calculate output image width and height based on BBox and target resolution
    # bbox format: [west, south, east, north] (EPSG:4326)
    west, south, east, north = bbox
    mean_lat = (south + north) / 2.0
    
    # Approx degrees to meters conversion constants
    meters_per_deg_lat = 111000.0
    meters_per_deg_lon = 111320.0 * math.cos(math.radians(mean_lat))

    width_deg = abs(east - west)
    height_deg = abs(north - south)

    width_m = width_deg * meters_per_deg_lon
    height_m = height_deg * meters_per_deg_lat

    width = int(width_m / resolution)
    height = int(height_m / resolution)

    # Clamp dimensions between 10 and 2500 px to respect Sentinel Hub limits and optimize response times
    width = max(10, min(2500, width))
    height = max(10, min(2500, height))

    # 3. Formulate the Process API request payload
    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                }
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": f"{date_from}T00:00:00Z",
                        "to": f"{date_to}T23:59:59Z"
                    },
                    "mosaickingOrder": "leastCC"
                }
            }]
        },
        "output": {
            "width": width,
            "height": height,
            "responses": [{
                "identifier": "default",
                "format": {"type": "image/tiff"}
            }]
        },
        "evalscript": NDVI_EVALSCRIPT
    }

    # 4. Make request to Process API
    url = "https://services.sentinel-hub.com/api/v1/process"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "image/tiff"
    }

    logger.info(f"Sending Process API request. Width: {width}px, Height: {height}px, BBox: {bbox}")
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            logger.info("Successfully fetched NDVI GeoTIFF from Sentinel Hub.")
            return response.content
        except httpx.HTTPStatusError as e:
            logger.error(f"Process API request failed: Status {e.response.status_code} - {e.response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Sentinel Hub API error: {e.response.text}"
            )
        except Exception as e:
            logger.error(f"Unexpected error during Sentinel Hub API request: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Sentinel Hub connection error: {str(e)}"
            )

def limit_bbox_size(bbox: List[float], max_size_m: float = 100000.0) -> List[float]:
    """
    Checks if the bounding box size in meters exceeds max_size_m.
    If it does, scales it down from the center to fit within the limit.
    """
    west, south, east, north = bbox
    mean_lat = (south + north) / 2.0
    
    # Degrees to meters conversion constants
    meters_per_deg_lat = 111000.0
    meters_per_deg_lon = 111320.0 * math.cos(math.radians(mean_lat))

    width_deg = abs(east - west)
    height_deg = abs(north - south)

    width_m = width_deg * meters_per_deg_lon
    height_m = height_deg * meters_per_deg_lat

    if width_m <= max_size_m and height_m <= max_size_m:
        return bbox

    # Calculate scale factor
    factor = min(max_size_m / width_m, max_size_m / height_m)
    
    # Calculate center
    center_lon = (west + east) / 2.0
    center_lat = (south + north) / 2.0
    
    # Scale from center
    half_width_deg = (width_deg * factor) / 2.0
    half_height_deg = (height_deg * factor) / 2.0
    
    new_bbox = [
        center_lon - half_width_deg,
        center_lat - half_height_deg,
        center_lon + half_width_deg,
        center_lat + half_height_deg
    ]
    
    logger.info(
        f"BBox size ({width_m:.1f}m x {height_m:.1f}m) exceeded limit of {max_size_m}m. "
        f"Shrunk bbox from center to {width_m * factor:.1f}m x {height_m * factor:.1f}m."
    )
    return new_bbox

async def fetch_historical_ndvi_series(
    bbox: List[float],
    years_back: int = 3
) -> List[dict]:
    """
    Fetches statistical monthly average NDVI values over the past N years for a bounding box.
    Uses the Sentinel Hub Statistical API.
    """
    # Shrink bbox to fit within safe limits if it is too large
    bbox = limit_bbox_size(bbox, max_size_m=100000.0)

    token = await token_manager.get_token()

    # Define time-range from N years ago until today
    import datetime
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=years_back * 365)

    # Use the Statistical API to retrieve clean metrics without downloading giant TIFFs
    url = "https://services.sentinel-hub.com/api/v1/statistics"
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # Evalscript specifically tailored to calculate mean NDVI and ignore cloudy pixels
    stat_evalscript = """//VERSION=3
    function setup() {
      return {
        input: [{
          bands: ["B04", "B08", "SCL", "dataMask"]
        }],
        output: [
          {
            id: "default",
            bands: 1,
            sampleType: "FLOAT32"
          },
          {
            id: "dataMask",
            bands: 1
          }
        ]
      };
    }
    function evaluatePixel(sample) {
      let invalidSCL = [0, 1, 3, 8, 9, 10];
      if (invalidSCL.includes(sample.SCL) || sample.dataMask === 0) {
        return {
          default: [NaN],
          dataMask: [0]
        };
      }
      let denominator = sample.B08 + sample.B04;
      if (denominator === 0) {
        return {
          default: [NaN],
          dataMask: [0]
        };
      }
      return {
        default: [(sample.B08 - sample.B04) / denominator],
        dataMask: [1]
      };
    }
    """

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                }
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {}
            }]
        },
        "aggregation": {
            "timeRange": {
                "from": f"{start_date.isoformat()}T00:00:00Z",
                "to": f"{end_date.isoformat()}T23:59:59Z"
            },
            "aggregationInterval": {
                "of": "P30D" # Group statistical values in roughly monthly intervals (30 days)
            },
            "evalscript": stat_evalscript,
            "resx": 20,
            "resy": 20
        }
    }

    logger.info(f"Fetching historical NDVI statistics from {start_date} to {end_date} for bbox {bbox}")
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            res_data = response.json()
            
            # Parse responses
            series = []
            for item in res_data.get("data", []):
                interval = item.get("interval", {})
                date_str = interval.get("from", "").split("T")[0]
                outputs = item.get("outputs", {}).get("default", {})
                
                # Check bands statistics
                bands_stats = outputs.get("bands", {}).get("B0", {})
                mean_ndvi = bands_stats.get("stats", {}).get("mean")
                
                if mean_ndvi is not None:
                    # Handle string "NaN" in JSON response
                    if isinstance(mean_ndvi, str):
                        if mean_ndvi.upper() == "NAN":
                            mean_ndvi = float("nan")
                        else:
                            try:
                                mean_ndvi = float(mean_ndvi)
                            except ValueError:
                                mean_ndvi = float("nan")
                    
                    if not math.isnan(mean_ndvi):
                        series.append({
                            "date": date_str,
                            "ndvi": float(mean_ndvi)
                        })
                    
            # Sort series chronologically
            series.sort(key=lambda x: x["date"])
            
            # Simple Linear Interpolation in pure Python (removes pandas dependency)
            if series:
                # Sort series chronologically
                series.sort(key=lambda x: x["date"])
                
                # Extract dates and values
                existing_dates = [x["date"] for x in series]
                existing_values = [x["ndvi"] for x in series]
                n = len(existing_values)
                
                # Perform basic linear interpolation for any None/NaN values (if they somehow exist)
                # and ensure all dates have continuous valid NDVI values.
                interpolated_values = []
                for i in range(n):
                    val = existing_values[i]
                    if val is not None and not math.isnan(val):
                        interpolated_values.append(val)
                        continue
                    
                    # Find surrounding known points
                    left_val, right_val = None, None
                    left_dist, right_dist = 0, 0
                    
                    # Look left
                    for j in range(i - 1, -1, -1):
                        if existing_values[j] is not None and not math.isnan(existing_values[j]):
                            left_val = existing_values[j]
                            left_dist = i - j
                            break
                    
                    # Look right
                    for j in range(i + 1, n):
                        if existing_values[j] is not None and not math.isnan(existing_values[j]):
                            right_val = existing_values[j]
                            right_dist = j - i
                            break
                    
                    # Interpolated value logic
                    if left_val is not None and right_val is not None:
                        interpolated_val = left_val + (right_val - left_val) * (left_dist / (left_dist + right_dist))
                    elif left_val is not None:
                        interpolated_val = left_val
                    elif right_val is not None:
                        interpolated_val = right_val
                    else:
                        interpolated_val = 0.0  # fallback
                    
                    interpolated_values.append(interpolated_val)
                
                series = [{"date": existing_dates[i], "ndvi": interpolated_values[i]} for i in range(n)]
                
            logger.info(f"Retrieved {len(series)} clean historical NDVI entries.")
            return series
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Statistical API failed: Status {e.response.status_code} - {e.response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Sentinel Hub statistical error: {e.response.text}"
            )
        except Exception as e:
            logger.error(f"Unexpected error fetching statistical NDVI series: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch historical NDVI series: {str(e)}"
            )

async def fetch_available_dates(
    bbox: List[float],
    date_from: str,
    date_to: str,
    max_cloud_cover: float = 20.0
) -> List[str]:
    """
    Queries Sentinel Hub Catalog API for available acquisition dates with low cloud cover.
    """
    bbox = limit_bbox_size(bbox, max_size_m=100000.0)
    token = await token_manager.get_token()

    url = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    payload = {
        "bbox": bbox,
        "datetime": f"{date_from}T00:00:00Z/{date_to}T23:59:59Z",
        "collections": ["sentinel-2-l2a"],
        "limit": 100,
        "query": {
            "eo:cloud_cover": {
                "lt": max_cloud_cover
            }
        }
    }

    logger.info(f"Querying catalog for available dates between {date_from} and {date_to} for bbox {bbox}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            res_data = response.json()

            dates = set()
            for feature in res_data.get("features", []):
                dt_str = feature.get("properties", {}).get("datetime")
                if dt_str:
                    dates.add(dt_str.split("T")[0])

            sorted_dates = sorted(list(dates))
            logger.info(f"Found {len(sorted_dates)} available dates.")
            return sorted_dates

        except httpx.HTTPStatusError as e:
            logger.error(f"Catalog API request failed: Status {e.response.status_code} - {e.response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Sentinel Hub Catalog API error: {e.response.text}"
            )
        except Exception as e:
            logger.error(f"Unexpected error during Catalog API request: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Catalog fetch connection error: {str(e)}"
            )

