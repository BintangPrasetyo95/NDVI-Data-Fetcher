/**
 * API client helper for sending bounding box and fetching NDVI GeoTIFF data.
 */
export async function fetchNDVI({ bbox, dateFrom, dateTo, resolution }) {
  const response = await fetch('/api/fetch-ndvi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bbox,
      date_from: dateFrom,
      date_to: dateTo,
      resolution: parseFloat(resolution),
    }),
  });

  if (!response.ok) {
    let errorMsg = 'An error occurred while communicating with the Sentinel Hub Proxy.';
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

  return response;
}

export async function fetchAvailableDates({ bbox, dateFrom, dateTo, maxCloudCover = 20.0 }) {
  const response = await fetch('/api/available-dates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bbox,
      date_from: dateFrom,
      date_to: dateTo,
      max_cloud_cover: parseFloat(maxCloudCover),
    }),
  });

  if (!response.ok) {
    let errorMsg = 'Failed to fetch available satellite dates.';
    try {
      const errData = await response.json();
      errorMsg = errData.detail || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }

  return response.json();
}

export async function exportNDVITimeSeries({ bbox, dates, resolution }) {
  const response = await fetch('/api/export-ndvi-timeseries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bbox,
      dates,
      resolution: parseFloat(resolution),
    }),
  });

  if (!response.ok) {
    let errorMsg = 'Failed to export time-series stack.';
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

  return response;
}
