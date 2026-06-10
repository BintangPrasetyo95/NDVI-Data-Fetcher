import logging
import asyncio
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler

app = FastAPI(title="NDVI Data Fetcher API", version="1.0.0")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    body = await request.body()
    logger.error(f"Validation failed: {exc.errors()} | Request Body: {body.decode('utf-8', errors='ignore')}")
    return await request_validation_exception_handler(request, exc)

# Enable CORS for the React development frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class NDVIRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="Bounding box coords: [west, south, east, north] (EPSG:4326)"
    )
    date_from: str = Field(..., description="Start date in YYYY-MM-DD format")
    date_to: str = Field(..., description="End date in YYYY-MM-DD format")
    resolution: float = Field(
        10.0,
        description="Spatial resolution in meters/pixel (range: 1 - 500)"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("Bounding box must contain exactly 4 floats [west, south, east, north]")
        
        west, south, east, north = v
        if not (-180 <= west <= 180):
            raise ValueError("West longitude must be between -180 and 180")
        if not (-180 <= east <= 180):
            raise ValueError("East longitude must be between -180 and 180")
        if not (-90 <= south <= 90):
            raise ValueError("South latitude must be between -90 and 90")
        if not (-90 <= north <= 90):
            raise ValueError("North latitude must be between -90 and 90")
        if west >= east:
            raise ValueError("West longitude must be less than East longitude")
        if south >= north:
            raise ValueError("South latitude must be less than North latitude")

        # Size check (max 100 km)
        mean_lat = (south + north) / 2.0
        import math
        meters_per_deg_lat = 111000.0
        meters_per_deg_lon = 111320.0 * math.cos(math.radians(mean_lat))
        width_m = abs(east - west) * meters_per_deg_lon
        height_m = abs(north - south) * meters_per_deg_lat
        
        if width_m > 100000.0 or height_m > 100000.0:
            raise ValueError(
                f"Selected area is too large ({width_m/1000:.1f} km x {height_m/1000:.1f} km). "
                f"Bounding box width and height must be under 100 km."
            )
        return v

    @field_validator("date_from", "date_to")
    @classmethod
    def validate_dates(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: float) -> float:
        if not (1.0 <= v <= 500.0):
            raise ValueError("Resolution must be between 1.0 and 500.0 meters/pixel")
        return v

@app.get("/api/health")
async def health_check():
    """
    Health check endpoint to ensure server is running.
    """
    return {"status": "ok"}

@app.post("/api/fetch-ndvi")
async def get_ndvi(request: NDVIRequest):
    """
    Fetches NDVI satellite image in GeoTIFF format for specified parameters.
    """
    logger.info(
        f"Received NDVI request: bbox={request.bbox}, "
        f"dates={request.date_from} to {request.date_to}, "
        f"resolution={request.resolution}m"
    )

    from sentinel_hub import fetch_ndvi_tiff

    # Check for presence of credentials
    import os
    if not os.getenv("SH_CLIENT_ID") or not os.getenv("SH_CLIENT_SECRET"):
        logger.error("Sentinel Hub Client ID/Secret not set in backend environment.")
        raise HTTPException(
            status_code=500,
            detail="Backend configuration error: Sentinel Hub credentials are not configured."
        )

    try:
        # Fetch raw GeoTIFF binary data
        tiff_bytes = await fetch_ndvi_tiff(
            bbox=request.bbox,
            date_from=request.date_from,
            date_to=request.date_to,
            resolution=request.resolution
        )

        filename = f"ndvi_{request.date_from}_to_{request.date_to}.tiff"
        
        # Return response as image/tiff binary stream
        return Response(
            content=tiff_bytes,
            media_type="image/tiff",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )

    except HTTPException as e:
        # Re-raise HTTPExceptions raised by fetch_ndvi_tiff
        raise e
    except Exception as e:
        logger.exception("Unexpected error in get_ndvi endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected server error occurred: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Historical NDVI Time-Series
# ---------------------------------------------------------------------------

class HistoricalNDVIRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="Bounding box coords: [west, south, east, north] (EPSG:4326)"
    )
    years_back: int = Field(
        3,
        description="Number of years of historical data to fetch (range: 1 - 5)"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("Bounding box must contain exactly 4 floats [west, south, east, north]")

        west, south, east, north = v
        if not (-180 <= west <= 180):
            raise ValueError("West longitude must be between -180 and 180")
        if not (-180 <= east <= 180):
            raise ValueError("East longitude must be between -180 and 180")
        if not (-90 <= south <= 90):
            raise ValueError("South latitude must be between -90 and 90")
        if not (-90 <= north <= 90):
            raise ValueError("North latitude must be between -90 and 90")
        if west >= east:
            raise ValueError("West longitude must be less than East longitude")
        if south >= north:
            raise ValueError("South latitude must be less than North latitude")

        # Size check (max 100 km)
        mean_lat = (south + north) / 2.0
        import math
        meters_per_deg_lat = 111000.0
        meters_per_deg_lon = 111320.0 * math.cos(math.radians(mean_lat))
        width_m = abs(east - west) * meters_per_deg_lon
        height_m = abs(north - south) * meters_per_deg_lat
        
        if width_m > 100000.0 or height_m > 100000.0:
            raise ValueError(
                f"Selected area is too large ({width_m/1000:.1f} km x {height_m/1000:.1f} km). "
                f"Bounding box width and height must be under 100 km."
            )
        return v

    @field_validator("years_back")
    @classmethod
    def validate_years_back(cls, v: int) -> int:
        if not (1 <= v <= 5):
            raise ValueError("years_back must be between 1 and 5")
        return v


@app.post("/api/fetch-historical-ndvi")
async def get_historical_ndvi(request: HistoricalNDVIRequest):
    """
    Fetches monthly-averaged historical NDVI time-series for the given bounding box along with NOAA climate data.
    """
    logger.info(
        f"Received historical NDVI request: bbox={request.bbox}, "
        f"years_back={request.years_back}"
    )

    from sentinel_hub import fetch_historical_ndvi_series
    from climate_api import fetch_historical_climate

    import os
    if not os.getenv("SH_CLIENT_ID") or not os.getenv("SH_CLIENT_SECRET"):
        logger.error("Sentinel Hub Client ID/Secret not set in backend environment.")
        raise HTTPException(
            status_code=500,
            detail="Backend configuration error: Sentinel Hub credentials are not configured."
        )

    try:
        # Run NDVI and Climate queries concurrently to optimize latency
        series_task = fetch_historical_ndvi_series(bbox=request.bbox, years_back=request.years_back)
        climate_task = fetch_historical_climate(bbox=request.bbox, years_back=request.years_back)
        
        series, climate = await asyncio.gather(series_task, climate_task)

        dates = [entry["date"] for entry in series]
        ndvi_values = [entry["ndvi"] for entry in series]

        # Align climate dates with Sentinel-Hub P30D dates.
        # Find closest match for each Sentinel-Hub date in Open-Meteo's monthly groups
        temp_aligned = []
        precip_aligned = []
        soil_aligned = []
        
        climate_months = climate.get("months", [])
        temps = climate.get("temperature", [])
        precips = climate.get("precipitation", [])
        soils = climate.get("soil_moisture", [])
        
        for date_str in dates:
            # Match by YYYY-MM
            ym = date_str[:7]
            if ym in climate_months:
                idx = climate_months.index(ym)
                temp_aligned.append(temps[idx])
                precip_aligned.append(precips[idx])
                soil_aligned.append(soils[idx])
            else:
                # Fallbacks if date is not in list
                temp_aligned.append(20.0 if not temp_aligned else temp_aligned[-1])
                precip_aligned.append(50.0 if not precip_aligned else precip_aligned[-1])
                soil_aligned.append(0.25 if not soil_aligned else soil_aligned[-1])

        return {
            "dates": dates,
            "ndvi_values": ndvi_values,
            "temperature_values": temp_aligned,
            "precipitation_values": precip_aligned,
            "soil_moisture_values": soil_aligned,
            "data_points": len(series)
        }

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Unexpected error in get_historical_ndvi endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected server error occurred: {str(e)}"
        )


# ---------------------------------------------------------------------------
# NDVI LSTM Forecast
# ---------------------------------------------------------------------------

class PredictNDVIRequest(BaseModel):
    ndvi_history: List[float] = Field(
        ...,
        description="Historical NDVI values (monthly averages) used for training"
    )
    temp_history: Optional[List[float]] = Field(
        None,
        description="Historical temperature values matching the NDVI dates"
    )
    precip_history: Optional[List[float]] = Field(
        None,
        description="Historical precipitation values matching the NDVI dates"
    )
    soil_history: Optional[List[float]] = Field(
        None,
        description="Historical soil moisture values matching the NDVI dates"
    )
    months_ahead: int = Field(
        6,
        description="Number of months to forecast (range: 1 - 24)"
    )

    @field_validator("ndvi_history")
    @classmethod
    def validate_ndvi_history(cls, v: List[float]) -> List[float]:
        if len(v) < 6:
            raise ValueError(
                f"ndvi_history must contain at least 6 values, got {len(v)}"
            )
        return v

    @field_validator("months_ahead")
    @classmethod
    def validate_months_ahead(cls, v: int) -> int:
        if not (1 <= v <= 24):
            raise ValueError("months_ahead must be between 1 and 24")
        return v


@app.post("/api/predict-ndvi")
async def predict_ndvi(request: PredictNDVIRequest):
    """
    Trains an LSTM model on the provided NDVI and climate history and forecasts future values.
    """
    logger.info(
        f"Received predict NDVI request: "
        f"history_length={len(request.ndvi_history)}, "
        f"months_ahead={request.months_ahead}"
    )

    try:
        from ml.forecaster import NDVIForecaster

        # Check if climate parameters are provided
        has_climate = (
            request.temp_history is not None and 
            request.precip_history is not None and 
            request.soil_history is not None and
            len(request.temp_history) == len(request.ndvi_history)
        )

        forecaster = NDVIForecaster(input_size=4 if has_climate else 1)
        
        # Build features list
        features = [request.ndvi_history]
        if has_climate:
            features.extend([request.temp_history, request.precip_history, request.soil_history])
        
        loss = forecaster.train_multivariate(features)
        logger.info(f"LSTM training complete. Final loss: {loss:.6f}")

        predictions = forecaster.predict_future_multivariate(
            features=features,
            months_ahead=request.months_ahead
        )

        return {
            "predictions": predictions,
            "training_loss": round(loss, 6),
            "months_ahead": request.months_ahead
        }

    except ValueError as e:
        logger.warning(f"Validation error during prediction: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in predict_ndvi endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected server error occurred: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Available Dates Querying
# ---------------------------------------------------------------------------

class AvailableDatesRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="Bounding box coords: [west, south, east, north] (EPSG:4326)"
    )
    date_from: str = Field(..., description="Start date in YYYY-MM-DD format")
    date_to: str = Field(..., description="End date in YYYY-MM-DD format")
    max_cloud_cover: float = Field(
        20.0,
        description="Maximum cloud cover percentage allowed (range: 0 - 100)"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("Bounding box must contain exactly 4 floats [west, south, east, north]")
        
        west, south, east, north = v
        if not (-180 <= west <= 180) or not (-180 <= east <= 180):
            raise ValueError("Longitudes must be between -180 and 180")
        if not (-90 <= south <= 90) or not (-90 <= north <= 90):
            raise ValueError("Latitudes must be between -90 and 90")
        if west >= east:
            raise ValueError("West longitude must be less than East longitude")
        if south >= north:
            raise ValueError("South latitude must be less than North latitude")
        return v

    @field_validator("date_from", "date_to")
    @classmethod
    def validate_dates(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v


@app.post("/api/available-dates")
async def get_available_dates(request: AvailableDatesRequest):
    """
    Retrieves available acquisition dates from Sentinel Hub Catalog API for a given region, range, and cloud cover.
    """
    logger.info(
        f"Received available dates request: bbox={request.bbox}, "
        f"date_from={request.date_from}, date_to={request.date_to}, "
        f"max_cloud_cover={request.max_cloud_cover}%"
    )

    from sentinel_hub import fetch_available_dates

    # Check for presence of credentials
    import os
    if not os.getenv("SH_CLIENT_ID") or not os.getenv("SH_CLIENT_SECRET"):
        logger.error("Sentinel Hub Client ID/Secret not set in backend environment.")
        raise HTTPException(
            status_code=500,
            detail="Backend configuration error: Sentinel Hub credentials are not configured."
        )

    try:
        dates = await fetch_available_dates(
            bbox=request.bbox,
            date_from=request.date_from,
            date_to=request.date_to,
            max_cloud_cover=request.max_cloud_cover
        )
        return {"dates": dates}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Unexpected error in get_available_dates endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected server error occurred: {str(e)}"
        )


# ---------------------------------------------------------------------------
# NDVI Time-Series ZIP Exporter
# ---------------------------------------------------------------------------

import io
import zipfile

class NDVITimeSeriesRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="Bounding box coords: [west, south, east, north] (EPSG:4326)"
    )
    dates: List[str] = Field(
        ...,
        description="List of dates (YYYY-MM-DD) to fetch individual GeoTIFFs for"
    )
    resolution: float = Field(
        10.0,
        description="Spatial resolution in meters/pixel (range: 1 - 500)"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("Bounding box must contain exactly 4 floats [west, south, east, north]")
        west, south, east, north = v
        if not (-180 <= west <= 180) or not (-180 <= east <= 180):
            raise ValueError("Longitudes must be between -180 and 180")
        if not (-90 <= south <= 90) or not (-90 <= north <= 90):
            raise ValueError("Latitudes must be between -90 and 90")
        if west >= east:
            raise ValueError("West longitude must be less than East longitude")
        if south >= north:
            raise ValueError("South latitude must be less than North latitude")
        return v

    @field_validator("dates")
    @classmethod
    def validate_dates(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("dates list cannot be empty")
        if len(v) > 20:
            raise ValueError("Maximum of 20 dates can be exported at once to avoid rate limits.")
        for date_str in v:
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"Date '{date_str}' must be in YYYY-MM-DD format")
        return v


@app.post("/api/export-ndvi-timeseries")
async def export_ndvi_timeseries(request: NDVITimeSeriesRequest):
    """
    Fetches NDVI GeoTIFFs for multiple individual dates and bundles them into a ZIP archive.
    """
    logger.info(
        f"Received NDVI time-series export request: bbox={request.bbox}, "
        f"num_dates={len(request.dates)}, resolution={request.resolution}m"
    )

    from sentinel_hub import fetch_ndvi_tiff

    # Check for credentials
    import os
    if not os.getenv("SH_CLIENT_ID") or not os.getenv("SH_CLIENT_SECRET"):
        logger.error("Sentinel Hub credentials not set in environment.")
        raise HTTPException(
            status_code=500,
            detail="Sentinel Hub credentials are not configured on the backend."
        )

    zip_buffer = io.BytesIO()

    try:
        # Fetch TIFFs concurrently to minimize latency (Sentinel Hub Process API supports concurrent requests well)
        tasks = []
        for date in request.dates:
            tasks.append(
                fetch_ndvi_tiff(
                    bbox=request.bbox,
                    date_from=date,
                    date_to=date,
                    resolution=request.resolution
                )
            )

        # Gather results
        results = await asyncio.gather(*tasks, return_exceptions=True)

        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for date, result in zip(request.dates, results):
                if isinstance(result, Exception):
                    logger.error(f"Failed to fetch NDVI for date {date}: {str(result)}")
                    # Write an error text file inside the zip for this date to notify user
                    error_bytes = f"Error fetching NDVI for {date}: {str(result)}".encode("utf-8")
                    zip_file.writestr(f"error_{date}.txt", error_bytes)
                else:
                    zip_file.writestr(f"ndvi_{date}.tiff", result)

        zip_buffer.seek(0)
        filename = f"ndvi_timeseries_{request.dates[0]}_to_{request.dates[-1]}.zip"

        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )

    except Exception as e:
        logger.exception("Unexpected error in export_ndvi_timeseries endpoint")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected server error occurred: {str(e)}"
        )
