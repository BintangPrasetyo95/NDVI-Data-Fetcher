/**
 * API client helpers for NDVI forecasting endpoints.
 * Follows the same error handling pattern as ndvi.js.
 */

/**
 * Fetch historical monthly NDVI data for a bounding box.
 * @param {{ bbox: number[], yearsBack: number }} params
 * @returns {Promise<Object>} JSON response with historical NDVI time-series
 */
export async function fetchHistoricalNDVI({ bbox, yearsBack }) {
  const response = await fetch('/api/fetch-historical-ndvi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bbox,
      years_back: yearsBack,
    }),
  });

  if (!response.ok) {
    let errorMsg = 'An error occurred while fetching historical NDVI data.';
    try {
      const errData = await response.json();
      errorMsg = errData.detail || errorMsg;
    } catch (e) {
      try {
        const text = await response.text();
        if (text) errorMsg = text;
      } catch (_) {}
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

/**
 * Run LSTM prediction on historical NDVI and climate data.
 * @param {{ ndviHistory: number[], tempHistory?: number[], precipHistory?: number[], soilHistory?: number[], monthsAhead: number }} params
 * @returns {Promise<Object>} JSON response with predicted NDVI values
 */
export async function predictNDVI({ ndviHistory, tempHistory, precipHistory, soilHistory, monthsAhead }) {
  const response = await fetch('/api/predict-ndvi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ndvi_history: ndviHistory,
      temp_history: tempHistory,
      precip_history: precipHistory,
      soil_history: soilHistory,
      months_ahead: monthsAhead,
    }),
  });

  if (!response.ok) {
    let errorMsg = 'An error occurred while running the NDVI prediction model.';
    try {
      const errData = await response.json();
      errorMsg = errData.detail || errorMsg;
    } catch (e) {
      try {
        const text = await response.text();
        if (text) errorMsg = text;
      } catch (_) {}
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
