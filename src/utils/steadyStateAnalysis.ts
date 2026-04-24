import type { DataPoint, SteadyStateAnalysis } from '../types/fluorescence';

/**
 * Find peak wavelength and intensity
 */
export function findPeak(data: DataPoint[]): { wavelength: number; intensity: number } {
  let maxIdx = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].y > data[maxIdx].y) maxIdx = i;
  }
  return { wavelength: data[maxIdx].x, intensity: data[maxIdx].y };
}

/**
 * Calculate FWHM (Full Width at Half Maximum)
 */
export function calculateFWHM(data: DataPoint[]): number {
  const peak = findPeak(data);
  const halfMax = peak.intensity / 2;

  // Find left edge
  let leftX = data[0].x;
  for (let i = 0; i < data.length; i++) {
    if (data[i].y >= halfMax) {
      if (i > 0) {
        // Interpolate
        const t = (halfMax - data[i - 1].y) / (data[i].y - data[i - 1].y);
        leftX = data[i - 1].x + t * (data[i].x - data[i - 1].x);
      } else {
        leftX = data[i].x;
      }
      break;
    }
  }

  // Find right edge
  let rightX = data[data.length - 1].x;
  let pastPeak = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i].x >= peak.wavelength) pastPeak = true;
    if (pastPeak && data[i].y <= halfMax) {
      if (i > 0) {
        const t = (halfMax - data[i - 1].y) / (data[i].y - data[i - 1].y);
        rightX = data[i - 1].x + t * (data[i].x - data[i - 1].x);
      } else {
        rightX = data[i].x;
      }
      break;
    }
  }

  return rightX - leftX;
}

/**
 * Calculate centroid (center of mass) wavelength
 */
export function calculateCentroid(data: DataPoint[]): number {
  let sumXY = 0;
  let sumY = 0;
  for (const p of data) {
    sumXY += p.x * p.y;
    sumY += p.y;
  }
  return sumY === 0 ? 0 : sumXY / sumY;
}

/**
 * Integrate spectrum using trapezoidal rule
 */
export function integrateSpectrum(data: DataPoint[]): number {
  let sum = 0;
  for (let i = 1; i < data.length; i++) {
    const dx = data[i].x - data[i - 1].x;
    sum += ((data[i].y + data[i - 1].y) / 2) * dx;
  }
  return sum;
}

/**
 * Full steady-state analysis
 */
export function analyzeSteadyState(data: DataPoint[]): SteadyStateAnalysis {
  const peak = findPeak(data);
  return {
    peakWavelength: peak.wavelength,
    peakIntensity: peak.intensity,
    fwhm: calculateFWHM(data),
    centroid: calculateCentroid(data),
    integratedIntensity: integrateSpectrum(data),
  };
}

/**
 * Smooth data using Savitzky-Golay-like moving average
 */
export function smoothData(data: DataPoint[], windowSize: number = 5): DataPoint[] {
  const half = Math.floor(windowSize / 2);
  return data.map((point, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
      sum += data[j].y;
      count++;
    }
    return { x: point.x, y: sum / count };
  });
}

/**
 * Normalize data to max = 1
 */
export function normalizeData(data: DataPoint[]): DataPoint[] {
  const max = Math.max(...data.map((p) => p.y));
  if (max === 0) return data;
  return data.map((p) => ({ x: p.x, y: p.y / max }));
}

/**
 * Subtract baseline (minimum value)
 */
export function subtractBaseline(data: DataPoint[]): DataPoint[] {
  const min = Math.min(...data.map((p) => p.y));
  return data.map((p) => ({ x: p.x, y: p.y - min }));
}
