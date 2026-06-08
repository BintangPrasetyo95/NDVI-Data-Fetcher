import logging
import datetime
import math
from typing import List, Dict, Any
import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

async def fetch_historical_climate(bbox: List[float], years_back: int = 3) -> Dict[str, List[float]]:
    """
    Fetches monthly-aggregated climate data (temperature, precipitation, soil moisture)
    for the center point of the bounding box using Open-Meteo's Archive API.
    
    Returns:
        dict: A dictionary mapping variables (temp, precip, soil_moisture) to a list of monthly values matching the dates.
    """
    # Calculate center of bounding box
    west, south, east, north = bbox
    lat = (south + north) / 2.0
    lon = (west + east) / 2.0
    
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=years_back * 365)
    
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "daily": ["temperature_2m_mean", "precipitation_sum", "soil_moisture_0_to_7cm_mean"],
        "timezone": "auto"
    }
    
    logger.info(f"Querying Open-Meteo for climate data at ({lat:.4f}, {lon:.4f}) from {start_date} to {end_date}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            res_data = response.json()
            
            daily_data = res_data.get("daily", {})
            time_list = daily_data.get("time", [])
            temp_list = daily_data.get("temperature_2m_mean", [])
            precip_list = daily_data.get("precipitation_sum", [])
            soil_list = daily_data.get("soil_moisture_0_to_7cm_mean", [])
            
            # Group by Year-Month to perform monthly averages to align with Sentinel-Hub P30D aggregation
            monthly_groups: Dict[str, Dict[str, List[float]]] = {}
            for i, date_str in enumerate(time_list):
                # Extract YYYY-MM
                ym = date_str[:7]
                if ym not in monthly_groups:
                    monthly_groups[ym] = {"temp": [], "precip": [], "soil": []}
                
                t = temp_list[i] if i < len(temp_list) else None
                p = precip_list[i] if i < len(precip_list) else None
                s = soil_list[i] if i < len(soil_list) else None
                
                if t is not None and not math.isnan(t):
                    monthly_groups[ym]["temp"].append(t)
                if p is not None and not math.isnan(p):
                    monthly_groups[ym]["precip"].append(p)
                if s is not None and not math.isnan(s):
                    monthly_groups[ym]["soil"].append(s)
            
            # Sort chronologically by month
            sorted_months = sorted(monthly_groups.keys())
            
            temps = []
            precips = []
            soils = []
            
            for ym in sorted_months:
                grp = monthly_groups[ym]
                avg_temp = sum(grp["temp"]) / len(grp["temp"]) if grp["temp"] else 20.0
                # Precipitation is summed over the month, not averaged
                sum_precip = sum(grp["precip"]) if grp["precip"] else 0.0
                avg_soil = sum(grp["soil"]) / len(grp["soil"]) if grp["soil"] else 0.2
                
                temps.append(avg_temp)
                precips.append(sum_precip)
                soils.append(avg_soil)
                
            return {
                "months": sorted_months,
                "temperature": temps,
                "precipitation": precips,
                "soil_moisture": soils
            }
            
        except Exception as e:
            logger.exception("Failed to fetch historical climate data from Open-Meteo")
            # Return safe default sequences so prediction doesn't crash if API fails
            logger.warning("Using fallback zero/dummy climate series")
            num_months = years_back * 12
            return {
                "months": [],
                "temperature": [20.0] * num_months,
                "precipitation": [50.0] * num_months,
                "soil_moisture": [0.25] * num_months
            }
