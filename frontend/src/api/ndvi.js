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
