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
  let invalidSCL = [0, 1, 3, 6, 8, 9, 10];
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
