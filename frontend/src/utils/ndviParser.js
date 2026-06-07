import * as GeoTIFF from 'geotiff';

/**
 * Maps an NDVI value to a color stop in the color ramp.
 * Value range: -1.0 to 1.0. NaN represents masked/cloudy/no-data pixels.
 */
export function getColorForNDVI(val) {
  if (val === null || val === undefined || isNaN(val)) {
    return [0, 0, 0, 0]; // Transparent for masked areas
  }

  // Smooth color ramp stops
  const stops = [
    { val: -1.0, color: [0, 100, 220] },     // Water / Clouds / Snow (blue)
    { val: -0.1, color: [135, 206, 250] },   // Shallow water / cloud edges (light blue)
    { val: 0.0,  color: [220, 200, 170] },   // Barren land / Rock / Sand (sandy brown)
    { val: 0.15, color: [240, 230, 140] },   // Very sparse vegetation / dry grass (light yellow)
    { val: 0.3,  color: [140, 210, 80] },    // Sparse/Moderate vegetation (light green)
    { val: 0.5,  color: [40, 160, 40] },     // Dense vegetation (forest/crops - green)
    { val: 0.8,  color: [0, 90, 0] },        // Extremely dense vegetation (dark green)
    { val: 1.0,  color: [0, 60, 0] }         // Maximum vegetation (very dark green)
  ];

  if (val <= stops[0].val) return [...stops[0].color, 255];
  if (val >= stops[stops.length - 1].val) return [...stops[stops.length - 1].color, 255];

  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (val >= s1.val && val <= s2.val) {
      const ratio = (val - s1.val) / (s2.val - s1.val);
      const r = Math.round(s1.color[0] + (s2.color[0] - s1.color[0]) * ratio);
      const g = Math.round(s1.color[1] + (s2.color[1] - s1.color[1]) * ratio);
      const b = Math.round(s1.color[2] + (s2.color[2] - s1.color[2]) * ratio);
      return [r, g, b, 220]; // 220 for nice semi-transparency
    }
  }
  return [0, 0, 0, 0];
}

/**
 * Parses a GeoTIFF array buffer, calculates vegetation level stats,
 * and renders a visual representation onto a Canvas, returning a DataURL.
 */
export async function parseNDVITiff(arrayBuffer) {
  console.log("parseNDVITiff called with:", arrayBuffer);
  if (!arrayBuffer) {
    throw new Error("parseNDVITiff received null/undefined arrayBuffer");
  }
  console.log("ArrayBuffer byteLength:", arrayBuffer.byteLength);

  let tiff;
  try {
    tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    console.log("Successfully loaded GeoTIFF from arrayBuffer:", tiff);
  } catch (err) {
    console.error("Error in GeoTIFF.fromArrayBuffer:", err);
    throw new Error(`Failed to initialize GeoTIFF parser: ${err.message}`);
  }

  let image;
  try {
    image = await tiff.getImage();
    console.log("Successfully retrieved first image:", image);
  } catch (err) {
    console.error("Error in tiff.getImage:", err);
    throw new Error(`Failed to retrieve image from TIFF: ${err.message}`);
  }

  const width = image.getWidth();
  const height = image.getHeight();
  console.log(`Image dimensions: ${width}x${height}`);
  
  let rasters;
  try {
    // Read first band (NDVI is single band)
    rasters = await image.readRasters();
    console.log("Successfully read rasters:", rasters);
  } catch (err) {
    console.error("Error in image.readRasters:", err);
    throw new Error(`Failed to read rasters from TIFF: ${err.message}`);
  }

  const ndviData = rasters[0]; // Float32Array
  
  // Initialize stats counters
  let totalValid = 0;
  let sum = 0;
  let min = 999;
  let max = -999;
  
  // Vegetation levels counts
  let barrenCount = 0;      // 0.0 - 0.15
  let sparseCount = 0;      // 0.15 - 0.3
  let moderateCount = 0;    // 0.3 - 0.5
  let denseCount = 0;       // 0.5 - 1.0
  let waterCount = 0;       // < 0.0
  let maskedCount = 0;      // NaN (Clouds/Water from SCL)

  // For histogram (24 bins from -0.2 to 1.0)
  const binMin = -0.2;
  const binMax = 1.0;
  const numBins = 24;
  const binWidth = (binMax - binMin) / numBins;
  const histogramBins = Array(numBins).fill(0);

  // Setup Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let i = 0; i < ndviData.length; i++) {
    const val = ndviData[i];
    
    // Pixel indexing: 4 bytes per pixel (RGBA)
    const idx = i * 4;
    const [r, g, b, a] = getColorForNDVI(val);
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;

    if (val === null || val === undefined || isNaN(val)) {
      maskedCount++;
      continue;
    }

    // Stats calculations
    totalValid++;
    sum += val;
    if (val < min) min = val;
    if (val > max) max = val;

    // Categories classification
    if (val < 0.0) {
      waterCount++;
    } else if (val < 0.15) {
      barrenCount++;
    } else if (val < 0.30) {
      sparseCount++;
    } else if (val < 0.50) {
      moderateCount++;
    } else {
      denseCount++;
    }

    // Histogram bins selection
    if (val >= binMin && val <= binMax) {
      const binIndex = Math.floor((val - binMin) / binWidth);
      const clampedBinIndex = Math.max(0, Math.min(numBins - 1, binIndex));
      histogramBins[clampedBinIndex]++;
    }
  }

  // Write image data to canvas
  ctx.putImageData(imgData, 0, 0);
  const visualOverlayUrl = canvas.toDataURL('image/png');

  // Compile results
  const mean = totalValid > 0 ? sum / totalValid : 0;
  const totalPixels = ndviData.length;
  
  // Create labels for histogram bins
  const histogramLabels = [];
  for (let i = 0; i < numBins; i++) {
    const binValStart = binMin + i * binWidth;
    const binValEnd = binValStart + binWidth;
    histogramLabels.push(`${binValStart.toFixed(2)} to ${binValEnd.toFixed(2)}`);
  }

  return {
    visualOverlayUrl,
    width,
    height,
    stats: {
      min: totalValid > 0 ? min : 0,
      max: totalValid > 0 ? max : 0,
      mean: totalValid > 0 ? mean : 0,
      totalPixels,
      totalValid,
      categories: {
        water: { count: waterCount, pct: (waterCount / totalPixels) * 100 },
        barren: { count: barrenCount, pct: (barrenCount / totalPixels) * 100 },
        sparse: { count: sparseCount, pct: (sparseCount / totalPixels) * 100 },
        moderate: { count: moderateCount, pct: (moderateCount / totalPixels) * 100 },
        dense: { count: denseCount, pct: (denseCount / totalPixels) * 100 },
        masked: { count: maskedCount, pct: (maskedCount / totalPixels) * 100 }
      },
      histogram: {
        bins: histogramBins,
        labels: histogramLabels,
        binWidth,
        binMin,
        binMax
      }
    }
  };
}
