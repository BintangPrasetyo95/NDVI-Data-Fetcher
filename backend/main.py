import logging
from typing import List
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
    Fetches monthly-averaged historical NDVI time-series for the given bounding box.
    """
    logger.info(
        f"Received historical NDVI request: bbox={request.bbox}, "
        f"years_back={request.years_back}"
    )

    from sentinel_hub import fetch_historical_ndvi_series

    import os
    if not os.getenv("SH_CLIENT_ID") or not os.getenv("SH_CLIENT_SECRET"):
        logger.error("Sentinel Hub Client ID/Secret not set in backend environment.")
        raise HTTPException(
            status_code=500,
            detail="Backend configuration error: Sentinel Hub credentials are not configured."
        )

    try:
        series = await fetch_historical_ndvi_series(
            bbox=request.bbox,
            years_back=request.years_back
        )

        dates = [entry["date"] for entry in series]
        ndvi_values = [entry["ndvi"] for entry in series]

        return {
            "dates": dates,
            "ndvi_values": ndvi_values,
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
    Trains an LSTM model on the provided NDVI history and forecasts future values.
    """
    logger.info(
        f"Received predict NDVI request: "
        f"history_length={len(request.ndvi_history)}, "
        f"months_ahead={request.months_ahead}"
    )

    try:
        from ml.forecaster import NDVIForecaster

        forecaster = NDVIForecaster()
        loss = forecaster.train(request.ndvi_history)
        logger.info(f"LSTM training complete. Final loss: {loss:.6f}")

        predictions = forecaster.predict_future(
            raw_history=request.ndvi_history,
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
