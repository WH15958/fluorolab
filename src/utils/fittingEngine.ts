/**
 * Transient fluorescence fitting engine
 * 
 * Supported models:
 *   - mono-exp:      A1 * exp(-t/tau1) + C
 *   - bi-exp:        A1 * exp(-t/tau1) + A2 * exp(-t/tau2) + C
 *   - tri-exp:       A1 * exp(-t/tau1) + A2 * exp(-t/tau2) + A3 * exp(-t/tau3) + C
 *   - power-law:     A * t^(-beta) + C
 *   - stretched-exp: A * exp(-(t/tau)^beta) + C
 *   - custom:        user-provided expression (uses mathjs)
 * 
 * Optional: IRF convolution (numerical convolution)
 */

import type { DataPoint, FitModelType, FitParameter, FitResult } from '../types/fluorescence';

// ===== Model Definitions =====

function monoExp(t: number, params: number[]): number {
  const [A1, tau1, C] = params;
  return A1 * Math.exp(-t / tau1) + C;
}

function biExp(t: number, params: number[]): number {
  const [A1, tau1, A2, tau2, C] = params;
  return A1 * Math.exp(-t / tau1) + A2 * Math.exp(-t / tau2) + C;
}

function triExp(t: number, params: number[]): number {
  const [A1, tau1, A2, tau2, A3, tau3, C] = params;
  return A1 * Math.exp(-t / tau1) + A2 * Math.exp(-t / tau2) + A3 * Math.exp(-t / tau3) + C;
}

function powerLaw(t: number, params: number[]): number {
  const [A, beta, C] = params;
  if (t <= 0) return C;
  return A * Math.pow(t, -beta) + C;
}

function stretchedExp(t: number, params: number[]): number {
  const [A, tau, beta, C] = params;
  if (tau <= 0 || beta <= 0) return C;
  return A * Math.exp(-Math.pow(t / tau, beta)) + C;
}

// ===== Custom Expression Evaluator =====
// Simple math expression parser without external dependencies
function buildCustomEvaluator(expression: string, paramNames: string[]) {
  // Replace ^ with ** for power
  let expr = expression.replace(/\^/g, '**');
  
  return function(t: number, params: number[]): number {
    try {
      const scope: Record<string, number> = { t, Math: Math as any };
      paramNames.forEach((name, i) => {
        scope[name] = params[i];
      });
      
      // Build function string
      const argList = ['t', ...paramNames].join(',');
      const fn = new Function(argList, `"use strict"; return ${expr};`);
      return fn(t, ...params);
    } catch {
      return NaN;
    }
  };
}

// ===== FFT-based Convolution =====
// Fast O(n log n) convolution using Cooley-Tukey FFT

/**
 * Compute FFT (Cooley-Tukey iterative algorithm)
 */
function fft(x: number[], y: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  if (n <= 1) return { re: [...x], im: [...y] };

  // Find power of 2 >= n
  let m = 1;
  while (m < n) m *= 2;
  
  // Pad to power of 2
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    re[i] = x[i];
    im[i] = y[i];
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < m - 1; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let k = m >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey iterative FFT
  for (let len = 2; len <= m; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < m; i += len) {
      let uRe = 1, uIm = 0;
      for (let jj = 0; jj < len / 2; jj++) {
        const tRe = uRe * re[i + jj + len / 2] - uIm * im[i + jj + len / 2];
        const tIm = uRe * im[i + jj + len / 2] + uIm * re[i + jj + len / 2];
        re[i + jj + len / 2] = re[i + jj] - tRe;
        im[i + jj + len / 2] = im[i + jj] - tIm;
        re[i + jj] += tRe;
        im[i + jj] += tIm;
        const tmp = uRe * wRe - uIm * wIm;
        uIm = uRe * wIm + uIm * wRe;
        uRe = tmp;
      }
    }
  }

  return { re: Array.from(re), im: Array.from(im) };
}

/**
 * Compute inverse FFT
 */
function ifft(re: number[], im: number[]): number[] {
  const n = re.length;
  // Conjugate
  for (let i = 0; i < n; i++) im[i] = -im[i];
  const result = fft(im, re);
  // Normalize and swap back
  return result.im.map(v => v / n);
}

/**
 * FFT-based convolution (O(n log n) instead of O(n²))
 */
function fftConvolve(a: number[], b: number[]): number[] {
  const resultLen = a.length + b.length - 1;
  let n = 1;
  while (n < resultLen) n *= 2;
  
  // Pad arrays
  const aPad = new Float64Array(n);
  const bPad = new Float64Array(n);
  for (let i = 0; i < a.length; i++) aPad[i] = a[i];
  for (let i = 0; i < b.length; i++) bPad[i] = b[i];
  
  // FFT of both
  const fa = fft(Array.from(aPad), new Array(n).fill(0));
  const fb = fft(Array.from(bPad), new Array(n).fill(0));
  
  // Pointwise multiply
  const fr = fa.re.map((v, i) => v * fb.re[i] - fa.im[i] * fb.im[i]);
  const fi = fa.re.map((v, i) => v * fb.im[i] + fa.im[i] * fb.re[i]);
  
  // Inverse FFT
  return ifft(fr, fi).slice(0, resultLen);
}

// ===== IRF Convolution =====

// Cache for interpolated IRF to avoid recomputation
let cachedIRF: { irfData: DataPoint[]; timeAxis: number[]; interp: number[] } | null = null;

function interpolateIRF(irfData: DataPoint[], timeAxis: number[]): number[] {
  // Check cache
  if (cachedIRF && 
      cachedIRF.irfData === irfData && 
      cachedIRF.timeAxis === timeAxis &&
      cachedIRF.interp.length === timeAxis.length) {
    return cachedIRF.interp;
  }
  
  const result = timeAxis.map((t) => {
    if (t <= irfData[0].x) return irfData[0].y;
    if (t >= irfData[irfData.length - 1].x) return irfData[irfData.length - 1].y;
    
    let lo = 0, hi = irfData.length - 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (irfData[mid].x <= t) lo = mid; else hi = mid;
    }
    
    const frac = (t - irfData[lo].x) / (irfData[hi].x - irfData[lo].x);
    return irfData[lo].y + frac * (irfData[hi].y - irfData[lo].y);
  });
  
  cachedIRF = { irfData, timeAxis, interp: result };
  return result;
}

/**
 * Convolve model decay with IRF using FFT (fast O(n log n))
 */
function convolveWithIRF(
  modelFn: (t: number, params: number[]) => number,
  params: number[],
  timeAxis: number[],
  irfData: DataPoint[]
): number[] {
  // Interpolate IRF onto timeAxis
  const irfInterp = interpolateIRF(irfData, timeAxis);
  
  // Compute model decay at each time point
  const modelValues = timeAxis.map((t) => modelFn(t, params));
  
  // Use FFT for fast convolution
  const convolved = fftConvolve(irfInterp, modelValues);
  
  // Normalize by dt and trim to original length
  const dt = timeAxis.length > 1 ? (timeAxis[timeAxis.length - 1] - timeAxis[0]) / (timeAxis.length - 1) : 1;
  return convolved.slice(0, timeAxis.length).map(v => v * dt);
}

/**
 * Clear IRF cache (call when IRF data changes)
 */
export function clearIRFCache(): void {
  cachedIRF = null;
}

// ===== Levenberg-Marquardt Minimizer =====
// A simplified LM optimizer for curve fitting

function computeChiSquared(residuals: number[], data: DataPoint[]): number {
  // Use Poisson statistics weighting (weight = 1/y for Poisson noise)
  let chi2 = 0;
  for (let i = 0; i < residuals.length; i++) {
    const weight = data[i].y > 0 ? 1 / data[i].y : 1;
    chi2 += residuals[i] * residuals[i] * weight;
  }
  return chi2;
}

function computeRSquared(data: DataPoint[], modelValues: number[]): number {
  const mean = data.reduce((s, p) => s + p.y, 0) / data.length;
  const ssTot = data.reduce((s, p) => s + (p.y - mean) ** 2, 0);
  const ssRes = data.reduce((s, p, i) => s + (p.y - (modelValues[i] ?? 0)) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

interface MinimizeOptions {
  maxIter?: number;
  tol?: number;
  lambda0?: number;
  earlyStopTol?: number;  // Early stopping threshold for cost improvement
  earlyStopPatience?: number;  // Number of iterations with small improvement before stopping
}

/**
 * Optimized gradient descent with adaptive step and early stopping
 */
function minimize(
  params: number[],
  costFn: (p: number[]) => number,
  bounds: { min: number[]; max: number[] },
  options: MinimizeOptions = {}
): number[] {
  const { 
    maxIter = 500,  // Reduced from 2000 for speed
    tol = 1e-8,      // Slightly relaxed tolerance
    earlyStopTol = 1e-12,  // Stop if improvement < this
    earlyStopPatience = 20  // Stop after 20 consecutive small improvements
  } = options;
  
  let current = [...params];
  let currentCost = costFn(current);
  let stepSize = 0.1;  // Increased initial step for faster convergence
  
  let patienceCounter = 0;
  let lastSignificantImprovement = currentCost;
  
  for (let iter = 0; iter < maxIter; iter++) {
    const gradient = numericalGradient(current, costFn, stepSize * 0.01);
    const gradNorm = Math.sqrt(gradient.reduce((s, g) => s + g * g, 0));
    
    if (gradNorm < tol) break;
    
    // Normalize gradient
    const step = gradient.map((g) => -stepSize * g / (gradNorm + 1e-10));
    
    const candidate = current.map((p, i) => {
      let np = p + step[i];
      np = Math.max(bounds.min[i], Math.min(bounds.max[i], np));
      return np;
    });
    
    const candidateCost = costFn(candidate);
    
    if (candidateCost < currentCost) {
      const improvement = currentCost - candidateCost;
      current = candidate;
      currentCost = candidateCost;
      stepSize *= 1.2;
      
      // Check for early stopping
      if (improvement < earlyStopTol) {
        patienceCounter++;
        if (patienceCounter >= earlyStopPatience) break;
      } else {
        patienceCounter = 0;
        lastSignificantImprovement = currentCost;
      }
    } else {
      stepSize *= 0.5;
      patienceCounter = 0;
      if (stepSize < 1e-15) break;
    }
  }
  
  return current;
}

function numericalGradient(
  params: number[],
  fn: (p: number[]) => number,
  h: number = 1e-5
): number[] {
  const f0 = fn(params);
  return params.map((_, i) => {
    const pPlus = [...params];
    pPlus[i] += h;
    return (fn(pPlus) - f0) / h;
  });
}

// ===== Main Fitting Function =====

export interface FitOptions {
  modelType: FitModelType;
  initialParams: number[];
  bounds: { min: number[]; max: number[] };
  irfData?: DataPoint[] | null;
  customExpression?: string;
  customParamNames?: string[];
}

export function fitTransientDecay(
  data: DataPoint[],
  options: FitOptions
): FitResult {
  const { modelType, initialParams, bounds, irfData, customExpression, customParamNames } = options;
  
  // Build model function
  let modelFn: (t: number, params: number[]) => number;
  switch (modelType) {
    case 'mono-exp': modelFn = monoExp; break;
    case 'bi-exp': modelFn = biExp; break;
    case 'tri-exp': modelFn = triExp; break;
    case 'power-law': modelFn = powerLaw; break;
    case 'stretched-exp': modelFn = stretchedExp; break;
    case 'custom':
      if (!customExpression) throw new Error('自定义函数表达式不能为空');
      modelFn = buildCustomEvaluator(customExpression, customParamNames || []);
      break;
    default: modelFn = monoExp;
  }
  
  const timeAxis = data.map((p) => p.x);
  const useIRF = !!irfData && irfData.length > 0;
  
  // Cost function
  function cost(params: number[]): number {
    let modelValues: number[];
    
    if (useIRF && irfData) {
      modelValues = convolveWithIRF(modelFn, params, timeAxis, irfData);
    } else {
      modelValues = timeAxis.map((t) => modelFn(t, params));
    }
    
    // Scale to match data peak
    const modelMax = Math.max(...modelValues);
    const dataMax = Math.max(...data.map((p) => p.y));
    const scale = modelMax > 0 ? dataMax / modelMax : 1;
    
    return data.reduce((sum, p, i) => {
      const weight = p.y > 0 ? 1 / (p.y + 1) : 1;
      return sum + weight * (p.y - modelValues[i] * scale) ** 2;
    }, 0);
  }
  
  // Optimize
  const fittedParams = minimize(initialParams, cost, bounds, { maxIter: 500 });
  
  // Compute fitted curve
  let fittedValues: number[];
  if (useIRF && irfData) {
    fittedValues = convolveWithIRF(modelFn, fittedParams, timeAxis, irfData);
  } else {
    fittedValues = timeAxis.map((t) => modelFn(t, fittedParams));
  }
  
  // Scale to data
  const modelMax = Math.max(...fittedValues);
  const dataMax = Math.max(...data.map((p) => p.y));
  const scale = modelMax > 0 ? dataMax / modelMax : 1;
  fittedValues = fittedValues.map((v) => v * scale);
  
  const fittedCurve = timeAxis.map((t, i) => ({ x: t, y: fittedValues[i] }));
  const residuals = data.map((p, i) => ({ x: p.x, y: p.y - fittedValues[i] }));
  
  const chiSquared = computeChiSquared(residuals.map((r) => r.y), data);
  const rSquared = computeRSquared(data, fittedValues);
  
  // Build parameter output with scaled values
  const paramNames = getParamNames(modelType, customParamNames);
  const parameters: FitParameter[] = fittedParams.map((val, i) => ({
    name: paramNames[i] || `p${i + 1}`,
    value: val,
    min: bounds.min[i],
    max: bounds.max[i],
  }));
  
  return {
    modelType,
    parameters,
    fittedCurve,
    residuals,
    chiSquared,
    rSquared,
    useIRF,
    customExpression,
  };
}

function getParamNames(modelType: FitModelType, customNames?: string[]): string[] {
  switch (modelType) {
    case 'mono-exp': return ['A₁', 'τ₁', 'C'];
    case 'bi-exp': return ['A₁', 'τ₁', 'A₂', 'τ₂', 'C'];
    case 'tri-exp': return ['A₁', 'τ₁', 'A₂', 'τ₂', 'A₃', 'τ₃', 'C'];
    case 'power-law': return ['A', 'β', 'C'];
    case 'stretched-exp': return ['A', 'τ', 'β', 'C'];
    case 'custom': return customNames || [];
    default: return [];
  }
}

/**
 * Calculate amplitude-weighted average lifetime
 * τ_avg = (Σ Ai * τi²) / (Σ Ai * τi)
 */
export function calculateAverageLifetime(parameters: FitParameter[], modelType: FitModelType): number | null {
  if (modelType === 'mono-exp') {
    const tau = parameters.find((p) => p.name.includes('τ'));
    return tau?.value ?? null;
  }
  
  if (modelType === 'bi-exp') {
    const A1 = parameters[0]?.value ?? 0;
    const tau1 = parameters[1]?.value ?? 0;
    const A2 = parameters[2]?.value ?? 0;
    const tau2 = parameters[3]?.value ?? 0;
    const num = A1 * tau1 * tau1 + A2 * tau2 * tau2;
    const den = A1 * tau1 + A2 * tau2;
    return den === 0 ? null : num / den;
  }
  
  if (modelType === 'tri-exp') {
    const A1 = parameters[0]?.value ?? 0;
    const tau1 = parameters[1]?.value ?? 0;
    const A2 = parameters[2]?.value ?? 0;
    const tau2 = parameters[3]?.value ?? 0;
    const A3 = parameters[4]?.value ?? 0;
    const tau3 = parameters[5]?.value ?? 0;
    const num = A1 * tau1 ** 2 + A2 * tau2 ** 2 + A3 * tau3 ** 2;
    const den = A1 * tau1 + A2 * tau2 + A3 * tau3;
    return den === 0 ? null : num / den;
  }
  
  return null;
}

// ===== Default Initial Parameters =====
export function getDefaultParams(modelType: FitModelType): {
  initial: number[];
  bounds: { min: number[]; max: number[] };
} {
  switch (modelType) {
    case 'mono-exp':
      return {
        initial: [1.0, 5.0, 0.0],
        bounds: { min: [0, 0.01, -1], max: [1e6, 1e5, 1e4] },
      };
    case 'bi-exp':
      return {
        initial: [0.6, 2.0, 0.4, 10.0, 0.0],
        bounds: { min: [0, 0.01, 0, 0.01, -1], max: [1e6, 1e5, 1e6, 1e5, 1e4] },
      };
    case 'tri-exp':
      return {
        initial: [0.4, 1.0, 0.4, 5.0, 0.2, 20.0, 0.0],
        bounds: { min: [0, 0.01, 0, 0.01, 0, 0.01, -1], max: [1e6, 1e5, 1e6, 1e5, 1e6, 1e5, 1e4] },
      };
    case 'power-law':
      return {
        initial: [1.0, 1.0, 0.0],
        bounds: { min: [0, 0.01, -1], max: [1e6, 10, 1e4] },
      };
    case 'stretched-exp':
      return {
        initial: [1.0, 5.0, 0.8, 0.0],
        bounds: { min: [0, 0.01, 0.01, -1], max: [1e6, 1e5, 1.0, 1e4] },
      };
    default:
      return { initial: [1.0, 1.0, 0.0], bounds: { min: [0, 0, 0], max: [1e6, 1e6, 1e4] } };
  }
}
