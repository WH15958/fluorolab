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

// ===== Peak Fitting =====

/** Compute 1st derivative of spectrum (for peak detection) */
function derivative(data: DataPoint[]): DataPoint[] {
  return data.slice(1).map((p, i) => ({
    x: p.x,
    y: (p.y - data[i].y) / (p.x - data[i].x),
  }));
}

/** Detect peaks by zero-crossing of derivative with sign change */
export function detectPeaks(
  data: DataPoint[],
  minProminence = 0.05
): DetectedPeak[] {
  const d = derivative(data);
  const peaks: DetectedPeak[] = [];
  const maxY = Math.max(...data.map((p) => p.y));

  for (let i = 1; i < d.length - 1; i++) {
    if (d[i].y > 0 && d[i + 1].y <= 0) {
      // Sign change: positive to negative = local max
      const center = data[i + 1].x;
      const amplitude = data[i + 1].y;

      if (amplitude < minProminence * maxY) continue;

      // Compute FWHM
      const halfMax = amplitude / 2;
      let leftX = data[0].x;
      let rightX = data[data.length - 1].x;

      for (let j = i + 1; j >= 0; j--) {
        if (data[j].y <= halfMax) {
          if (j < i) {
            const t = (halfMax - data[j].y) / (data[j + 1].y - data[j].y);
            leftX = data[j].x + t * (data[j + 1].x - data[j].x);
          }
          break;
        }
      }
      for (let j = i + 1; j < data.length; j++) {
        if (data[j].y <= halfMax) {
          const t = (data[j - 1].y - halfMax) / (data[j - 1].y - data[j].y);
          rightX = data[j - 1].x + t * (data[j].x - data[j - 1].x);
          break;
        }
      }

      peaks.push({ center, amplitude, fwhm: rightX - leftX });
    }
  }

  return peaks;
}

// ===== Peak shape functions =====

function gaussian(x: number, A: number, xc: number, sigma: number): number {
  const dx = x - xc;
  return A * Math.exp(-(dx * dx) / (2 * sigma * sigma));
}

function lorentzian(x: number, A: number, xc: number, gamma: number): number {
  const dx = x - xc;
  const g2 = (gamma / 2) * (gamma / 2);
  return (A * g2) / (dx * dx + g2);
}

function pseudoVoigt(x: number, A: number, xc: number, fwhm: number, mu: number): number {
  const sigma = fwhm / 2.355;
  const gamma = fwhm;
  const g = gaussian(x, A, xc, sigma);
  const l = lorentzian(x, A, xc, gamma);
  return (1 - mu) * g + mu * l;
}

/** Gaussian FWHM = 2.355 * sigma, area = A * sigma * sqrt(2π) */
function gaussianArea(A: number, fwhm: number): number {
  return A * (fwhm / 2.355) * Math.sqrt(2 * Math.PI);
}

/** Lorentzian area = A * π * gamma / 2 = A * π * fwhm / 2 */
function lorentzianArea(A: number, fwhm: number): number {
  return A * Math.PI * fwhm / 2;
}

/** Pseudo-Voigt area ≈ weighted average of Gaussian and Lorentzian areas */
function pseudoVoigtArea(A: number, fwhm: number, mu: number): number {
  return (1 - mu) * gaussianArea(A, fwhm) + mu * lorentzianArea(A, fwhm);
}

// ===== Multi-peak model =====

function peakValue(
  x: number,
  p: PeakParams
): number {
  switch (p.shape) {
    case 'gaussian': {
      const sigma = p.fwhm / 2.355;
      return gaussian(x, p.amplitude, p.center, sigma);
    }
    case 'lorentzian': {
      return lorentzian(x, p.amplitude, p.center, p.fwhm);
    }
    case 'voigt': {
      return pseudoVoigt(x, p.amplitude, p.center, p.fwhm, p.mu);
    }
  }
}

function multiPeakModel(
  x: number,
  peaks: PeakParams[],
  baseline: number
): number {
  return baseline + peaks.reduce((sum, p) => sum + peakValue(x, p), 0);
}

// ===== Levenberg-Marquardt Fitting =====

type ResidualFn = (params: number[]) => number[];

function lmFit(
  initialParams: number[],
  residualFn: ResidualFn,
  nData: number,
  lambdaInit = 0.001,
  maxIter = 200,
  tol = 1e-6
): { params: number[]; iters: number; converged: boolean } {
  let params = [...initialParams];
  let lambda = lambdaInit;
  const n = params.length;
  let prevChiSq = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    const residuals = residualFn(params);
    const chiSq = residuals.reduce((s, r) => s + r * r, 0) / nData;

    if (Math.abs(prevChiSq - chiSq) / (prevChiSq + 1e-10) < tol) {
      return { params, iters: iter + 1, converged: true };
    }
    prevChiSq = chiSq;

    // Compute Jacobian numerically
    const eps = 1e-8;
    const J: number[][] = params.map((p, j) => {
      const pPlus = [...params];
      pPlus[j] += eps;
      const rPlus = residualFn(pPlus);
      return residuals.map((r, i) => (rPlus[i] - r) / eps);
    });

    // Compute JtJ and Jtr
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr: number[] = new Array(n).fill(0);
    for (let i = 0; i < nData; i++) {
      for (let j = 0; j < n; j++) {
        Jtr[j] += J[j][i] * residuals[i];
        for (let k = 0; k < n; k++) {
          JtJ[j][k] += J[j][i] * J[k][i];
        }
      }
    }

    // Add damping: JtJ + lambda * diag(JtJ)
    for (let j = 0; j < n; j++) {
      JtJ[j][j] *= 1 + lambda;
    }

    // Solve linear system JtJ * delta = Jtr
    const delta = solveLinear(JtJ, Jtr);
    const newParams = params.map((p, j) => p + delta[j]);

    const newResiduals = residualFn(newParams);
    const newChiSq = newResiduals.reduce((s, r) => s + r * r, 0) / nData;

    if (newChiSq < chiSq) {
      params = newParams;
      lambda *= 0.5;
    } else {
      lambda *= 2;
    }
  }

  return { params, iters: maxIter, converged: false };
}

/** Simple Gauss-Jordan linear system solver */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) continue;

    const piv = aug[col][col];
    for (let j = col; j <= n; j++) aug[col][j] /= piv;

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = aug[row][col];
        for (let j = col; j <= n; j++) {
          aug[row][j] -= factor * aug[col][j];
        }
      }
    }
  }

  return aug.map((row) => row[n]);
}

// ===== Main Peak Fitting Function =====

export function fitPeaks(
  data: DataPoint[],
  initialPeaks: PeakParams[],
  baseline0 = 0
): PeakFitResult {
  if (data.length < 2 || initialPeaks.length === 0) {
    return {
      peaks: [],
      baseline: baseline0,
      fittedCurve: data,
      residuals: data.map((p) => ({ x: p.x, y: 0 })),
      rSquared: 0,
      reducedChiSq: 0,
      totalArea: 0,
    };
  }

  const nPeaks = initialPeaks.length;

  // Build parameter vector:
  // [baseline, peak1_amplitude, peak1_center, peak1_fwhm, peak1_mu,
  //  peak2_amplitude, ...]
  // mu is only used for Voigt, but we include it for all and clamp

  const toVec = (peaks: PeakParams[], baseline: number): number[] => {
    const vec: number[] = [baseline];
    for (const p of peaks) {
      vec.push(p.amplitude, p.center, p.fwhm, p.mu);
    }
    return vec;
  };

  const fromVec = (vec: number[]): { peaks: PeakParams[]; baseline: number } => {
    const baseline = vec[0];
    const peaks: PeakParams[] = [];
    for (let i = 0; i < nPeaks; i++) {
      const base = 1 + i * 4;
      peaks.push({
        id: initialPeaks[i].id,
        amplitude: Math.max(0, vec[base]),
        center: vec[base + 1],
        fwhm: Math.max(0.1, vec[base + 2]),
        shape: initialPeaks[i].shape,
        mu: Math.max(0, Math.min(1, vec[base + 3])),
      });
    }
    return { peaks, baseline };
  };

  let params = toVec(initialPeaks, baseline0);

  const residualFn = (par: number[]): number[] => {
    const { peaks, baseline } = fromVec(par);
    return data.map((pt) => {
      const yModel = multiPeakModel(pt.x, peaks, baseline);
      return pt.y - yModel;
    });
  };

  const result = lmFit(params, residualFn, data.length);
  const { peaks: finalPeaks, baseline: finalBaseline } = fromVec(result.params);

  const fittedCurve: DataPoint[] = data.map((pt) => ({
    x: pt.x,
    y: Math.max(0, multiPeakModel(pt.x, finalPeaks, finalBaseline)),
  }));

  const residuals: DataPoint[] = data.map((pt, i) => ({
    x: pt.x,
    y: pt.y - fittedCurve[i].y,
  }));

  // R²
  const meanY = data.reduce((s, p) => s + p.y, 0) / data.length;
  const ssTot = data.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = residuals.reduce((s, p) => s + p.y * p.y, 0);
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const chiSq = ssRes / data.length;

  // Total area
  const totalArea = finalPeaks.reduce((sum, p) => {
    if (p.shape === 'gaussian') return sum + gaussianArea(p.amplitude, p.fwhm);
    if (p.shape === 'lorentzian') return sum + lorentzianArea(p.amplitude, p.fwhm);
    return sum + pseudoVoigtArea(p.amplitude, p.fwhm, p.mu);
  }, 0);

  return {
    peaks: finalPeaks,
    baseline: finalBaseline,
    fittedCurve,
    residuals,
    rSquared,
    reducedChiSq: chiSq,
    totalArea,
  };
}

// ===== Export Functions =====

export function exportToCSV(data: DataPoint[], filename = 'data.csv'): void {
  const header = 'x,y\n';
  const rows = data.map((p) => `${p.x},${p.y}`).join('\n');
  downloadFile(header + rows, filename, 'text/csv');
}

export function exportChartPNG(
  chartRef: HTMLDivElement | null,
  filename = 'chart.png',
  scale = 2
): void {
  if (!chartRef) return;

  // Use html-to-image if available, otherwise canvas fallback
  const el = chartRef;
  const rect = el.getBoundingClientRect();

  const canvas = document.createElement('canvas');
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Draw background
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Get all SVG and canvas children
  const svgElements = el.querySelectorAll('svg');
  let svgData = '';
  svgElements.forEach((svg) => {
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));
    svgData += new XMLSerializer().serializeToString(clone);
  });

  // Simple SVG-to-canvas via img
  const img = new Image();
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, 'image/png');
  };

  img.onerror = () => {
    // Fallback: just download as SVG if available
    if (svgData) {
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
      downloadBlob(svgBlob, filename.replace('.png', '.svg'));
    }
  };

  img.src = url;
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** Export multi-dataset as CSV with named columns */
export function exportMultiDatasetCSV(
  datasets: { name: string; data: DataPoint[] }[],
  filename = 'spectra.csv'
): void {
  const maxLen = Math.max(...datasets.map((d) => d.data.length));
  const allX = new Set<number>();
  datasets.forEach((d) => d.data.forEach((p) => allX.add(p.x)));
  const xs = Array.from(allX).sort((a, b) => a - b);

  const header = ['x', ...datasets.map((d) => d.name)].join(',');
  const rows = xs.map((x) => {
    const vals = [x];
    for (const d of datasets) {
      const pt = d.data.find((p) => Math.abs(p.x - x) < 1e-6);
      vals.push(pt ? pt.y : '');
    }
    return vals.join(',');
  });

  downloadFile([header, ...rows].join('\n'), filename, 'text/csv');
}
