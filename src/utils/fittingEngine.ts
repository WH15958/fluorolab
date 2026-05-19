/**
 * Transient fluorescence fitting engine — professional implementation
 * 
 * Supports two fitting modes:
 *   1. Direct fitting: fit exponential decay to selected range (no IRF)
 *   2. Reconvolution fitting: convolve model with IRF, fit entire curve
 * 
 * Key design decisions:
 *   - Internal data normalization for numerical stability
 *   - Levenberg-Marquardt optimizer (industry standard)
 *   - IRF normalization before convolution
 *   - Parameter un-normalization for output
 * 
 * Supported models:
 *   - mono-exp:      A1 * exp(-t/τ1) + C
 *   - bi-exp:        A1 * exp(-t/τ1) + A2 * exp(-t/τ2) + C
 *   - tri-exp:       A1 * exp(-t/τ1) + A2 * exp(-t/τ2) + A3 * exp(-t/τ3) + C
 *   - power-law:     A * t^(-β) + C
 *   - stretched-exp: A * exp(-(t/τ)^β) + C
 *   - custom:        user-provided expression
 */

import type { DataPoint, FitModelType, FitParameter, FitResult } from '../types/fluorescence';

// ===== Model Definitions =====

function monoExp(t: number, params: number[]): number {
  const [A1, tau1, C] = params;
  if (tau1 <= 0) return C;
  return A1 * Math.exp(-t / tau1) + C;
}

function biExp(t: number, params: number[]): number {
  const [A1, tau1, A2, tau2, C] = params;
  if (tau1 <= 0 || tau2 <= 0) return C;
  return A1 * Math.exp(-t / tau1) + A2 * Math.exp(-t / tau2) + C;
}

function triExp(t: number, params: number[]): number {
  const [A1, tau1, A2, tau2, A3, tau3, C] = params;
  if (tau1 <= 0 || tau2 <= 0 || tau3 <= 0) return C;
  return A1 * Math.exp(-t / tau1) + A2 * Math.exp(-t / tau2) + A3 * Math.exp(-t / tau3) + C;
}

function powerLaw(t: number, params: number[]): number {
  const [A, beta, C] = params;
  if (t <= 0) return C;
  return A * Math.pow(t, -beta) + C;
}

function stretchedExp(t: number, params: number[]): number {
  const [A, tau, beta, C] = params;
  if (tau <= 0 || beta <= 0 || t < 0) return C;
  return A * Math.exp(-Math.pow(t / tau, beta)) + C;
}

// ===== Custom Expression Evaluator =====

function buildCustomEvaluator(expression: string, paramNames: string[]) {
  const expr = expression.replace(/\^/g, '**');
  return function(t: number, params: number[]): number {
    try {
      const argList = ['t', ...paramNames].join(',');
      const fn = new Function(argList, `"use strict"; return ${expr};`);
      return fn(t, ...params);
    } catch {
      return NaN;
    }
  };
}

// ===== IRF Convolution =====

let cachedIRFKey = '';
let cachedIRFInterp: number[] | null = null;

function interpolateIRF(irfData: DataPoint[], timeAxis: number[]): number[] {
  const key = `${irfData[0]?.x ?? ''}_${irfData.length}_${timeAxis[0]}_${timeAxis.length}`;
  if (cachedIRFKey === key && cachedIRFInterp && cachedIRFInterp.length === timeAxis.length) {
    return cachedIRFInterp;
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
  
  cachedIRFKey = key;
  cachedIRFInterp = result;
  return result;
}

/**
 * Convolve model decay with normalized IRF
 * Result: I(t) = ∫ IRF_norm(τ) * decay(t - τ) dτ
 * IRF is normalized to unit area so amplitude params are physically meaningful
 */
function convolveWithIRF(
  modelFn: (t: number, params: number[]) => number,
  params: number[],
  timeAxis: number[],
  irfData: DataPoint[]
): number[] {
  const irfInterp = interpolateIRF(irfData, timeAxis);
  
  const n = timeAxis.length;
  const dt = n > 1 ? (timeAxis[n - 1] - timeAxis[0]) / (n - 1) : 1;
  
  // Normalize IRF to unit area
  const irfArea = irfInterp.reduce((s, v) => s + v, 0) * dt;
  const irfNorm = irfArea > 0 ? irfInterp.map(v => v / irfArea) : irfInterp;
  
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    let conv = 0;
    for (let j = 0; j <= i; j++) {
      const tau_val = timeAxis[i] - timeAxis[j];
      conv += irfNorm[j] * modelFn(tau_val, params);
    }
    result.push(conv * dt);
  }
  
  return result;
}

export function clearIRFCache(): void {
  cachedIRFKey = '';
  cachedIRFInterp = null;
}

// ===== Statistics =====

function computeChiSquared(residuals: number[], data: DataPoint[]): number {
  let chi2 = 0;
  for (let i = 0; i < residuals.length; i++) {
    // Poisson weighting: weight = 1/y for photon counting data
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

// ===== Levenberg-Marquardt Optimizer =====

/**
 * LM optimizer with internal parameter scaling for numerical stability.
 * All parameters are mapped to ~O(1) range internally.
 */
function minimizeLM(
  initialParams: number[],
  residualsFn: (params: number[]) => number[],
  bounds: { min: number[]; max: number[] },
  maxIter: number = 300
): number[] {
  const n = initialParams.length;
  let params = [...initialParams];
  let lambda = 1e-3;
  
  let residuals = residualsFn(params);
  let cost = residuals.reduce((s, r) => s + r * r, 0);
  
  for (let iter = 0; iter < maxIter; iter++) {
    const jacobian = computeJacobian(residualsFn, params);
    const nData = jacobian.length;
    
    // Build normal equations: (J^T J + λ diag) δ = -J^T r
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr: number[] = new Array(n).fill(0);
    
    for (let i = 0; i < nData; i++) {
      for (let j = 0; j < n; j++) {
        Jtr[j] += jacobian[i][j] * residuals[i];
        for (let k = 0; k < n; k++) {
          JtJ[j][k] += jacobian[i][j] * jacobian[i][k];
        }
      }
    }
    
    // Marquardt damping: add λ * |diag| to improve conditioning
    const dampedJtJ = JtJ.map((row, i) => {
      const newRow = [...row];
      newRow[i] += lambda * (Math.abs(JtJ[i][i]) + 1e-10);
      return newRow;
    });
    
    const delta = solveLinearSystem(dampedJtJ, Jtr.map(v => -v));
    if (!delta) {
      lambda *= 10;
      if (lambda > 1e16) break;
      continue;
    }
    
    // Apply bounds
    const candidate = params.map((p, i) => {
      let np = p + delta[i];
      np = Math.max(bounds.min[i], Math.min(bounds.max[i], np));
      return np;
    });
    
    const newResiduals = residualsFn(candidate);
    const newCost = newResiduals.reduce((s, r) => s + r * r, 0);
    
    if (newCost < cost) {
      const improvement = cost > 0 ? (cost - newCost) / cost : 0;
      params = candidate;
      residuals = newResiduals;
      cost = newCost;
      lambda = Math.max(lambda * 0.1, 1e-15);
      if (improvement < 1e-12) break;
    } else {
      lambda *= 10;
      if (lambda > 1e16) break;
    }
  }
  
  return params;
}

function computeJacobian(
  residualsFn: (params: number[]) => number[],
  params: number[],
  relStep: number = 1e-7
): number[][] {
  const n = params.length;
  const baseResiduals = residualsFn(params);
  const nData = baseResiduals.length;
  const jacobian: number[][] = Array.from({ length: nData }, () => new Array(n).fill(0));
  
  for (let j = 0; j < n; j++) {
    const step = Math.max(relStep, Math.abs(params[j]) * relStep);
    const pPlus = [...params];
    pPlus[j] += step;
    const pMinus = [...params];
    pMinus[j] -= step;
    
    const rPlus = residualsFn(pPlus);
    const rMinus = residualsFn(pMinus);
    
    for (let i = 0; i < nData; i++) {
      jacobian[i][j] = (rPlus[i] - rMinus[i]) / (2 * step);
    }
  }
  
  return jacobian;
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-30) return null;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }
  
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i][j] * x[j];
    }
    if (Math.abs(aug[i][i]) < 1e-30) return null;
    x[i] = sum / aug[i][i];
  }
  return x;
}

// ===== Smart Initial Parameter Estimation =====

/**
 * Estimate initial parameters from data characteristics using log-space analysis.
 * This identifies decay components by looking at the slope of log(I) vs t.
 */
function estimateInitialParams(
  data: DataPoint[],
  modelType: FitModelType,
  useIRF: boolean
): { initial: number[]; bounds: { min: number[]; max: number[] } } {
  if (data.length < 3) {
    return getDefaultParams(modelType);
  }
  
  const dataMax = Math.max(...data.map(p => p.y));
  const firstX = data[0].x;
  
  // Baseline estimate: average of last 10% of data
  const tailStart = Math.floor(data.length * 0.9);
  const baseline = data.slice(tailStart).reduce((s, p) => s + p.y, 0) / Math.max(1, data.length - tailStart);
  
  // Peak amplitude above baseline
  const peakAmp = dataMax - baseline;
  
  // Estimate dominant tau from 1/e decay point
  const targetY = baseline + peakAmp * Math.exp(-1);
  let dominantTau = 5;
  for (let i = 1; i < data.length; i++) {
    if (data[i].y <= targetY) {
      const frac = (targetY - data[i - 1].y) / (data[i].y - data[i - 1].y);
      const t1e = data[i - 1].x + frac * (data[i].x - data[i - 1].x);
      dominantTau = Math.max(0.1, Math.abs(t1e - firstX));
      break;
    }
  }
  
  // Estimate fast tau from early decay (10% to 30% of range)
  const y10 = baseline + peakAmp * 0.9;
  const y30 = baseline + peakAmp * 0.7;
  let fastTau = dominantTau * 0.3;
  let x10 = firstX, x30 = firstX;
  for (let i = 1; i < data.length; i++) {
    if (data[i].y <= y10 && x10 === firstX) {
      x10 = data[i].x;
    }
    if (data[i].y <= y30 && x30 === firstX) {
      x30 = data[i].x;
      break;
    }
  }
  if (x30 > x10) {
    // From y = A*exp(-t/tau), tau = dt / ln(y1/y2)
    fastTau = Math.max(0.1, (x30 - x10) / Math.log(y10 / y30));
  }
  
  // Estimate slow tau from tail decay
  const y70 = baseline + peakAmp * 0.3;
  const y90 = baseline + peakAmp * 0.1;
  let slowTau = dominantTau * 5;
  let x70 = -1, x90 = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i].y <= y70 && x70 < 0) x70 = data[i].x;
    if (data[i].y <= y90 && x90 < 0) { x90 = data[i].x; break; }
  }
  if (x90 > x70 && x70 > 0) {
    slowTau = Math.max(1, (x90 - x70) / Math.log(y70 / y90));
  }
  
  // For deconvolution, taus are typically smaller
  const tauFactor = useIRF ? 0.5 : 1.0;
  
  switch (modelType) {
    case 'mono-exp': {
      return {
        initial: [peakAmp, dominantTau * tauFactor, baseline],
        bounds: { min: [0, 0.01, -dataMax], max: [dataMax * 10, 1e5, dataMax * 2] },
      };
    }
    case 'bi-exp': {
      return {
        initial: [
          peakAmp * 0.7, fastTau * tauFactor,
          peakAmp * 0.3, slowTau * tauFactor,
          baseline,
        ],
        bounds: {
          min: [0, 0.01, 0, 0.01, -dataMax],
          max: [dataMax * 10, 1e5, dataMax * 10, 1e5, dataMax * 2],
        },
      };
    }
    case 'tri-exp': {
      return {
        initial: [
          peakAmp * 0.5, fastTau * tauFactor,
          peakAmp * 0.35, dominantTau * tauFactor,
          peakAmp * 0.15, slowTau * tauFactor,
          baseline,
        ],
        bounds: {
          min: [0, 0.01, 0, 0.01, 0, 0.01, -dataMax],
          max: [dataMax * 10, 1e5, dataMax * 10, 1e5, dataMax * 10, 1e5, dataMax * 2],
        },
      };
    }
    case 'power-law': {
      return {
        initial: [peakAmp, 1.0, baseline],
        bounds: { min: [0, 0.01, -dataMax], max: [dataMax * 10, 10, dataMax * 2] },
      };
    }
    case 'stretched-exp': {
      return {
        initial: [peakAmp, dominantTau, 0.8, baseline],
        bounds: { min: [0, 0.01, 0.01, -dataMax], max: [dataMax * 10, 1e5, 1.0, dataMax * 2] },
      };
    }
    default:
      return getDefaultParams(modelType);
  }
}

// ===== Main Fitting Function =====

export interface FitOptions {
  modelType: FitModelType;
  initialParams: number[];
  bounds: { min: number[]; max: number[] };
  irfData?: DataPoint[] | null;
  customExpression?: string;
  customParamNames?: string[];
  fullTimeAxis?: number[];
  fitRange?: { start: number | null; end: number | null };
  useSmartInitials?: boolean;
  timeOffset?: number;  // t₀: time offset for direct fitting (t' = t - t₀)
}

export function fitTransientDecay(
  data: DataPoint[],
  options: FitOptions
): FitResult {
  const { modelType, initialParams, bounds, irfData, customExpression, customParamNames, fullTimeAxis, fitRange, useSmartInitials = true, timeOffset } = options;
  
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
  
  const timeAxis = data.map(p => p.x);
  const useIRF = !!irfData && irfData.length > 0;
  
  // ===== Time offset for direct fitting =====
  // For direct fitting (no IRF), we shift time so t'=0 at the start of fitting range.
  // This makes A represent the amplitude at the fitting start point, not at t=0.
  // For reconvolution fitting, we use absolute time (IRF convolution needs it).
  const t0 = (!useIRF && timeOffset != null) ? timeOffset : 
             (!useIRF ? (fitRange?.start ?? timeAxis[0] ?? 0) : 0);
  
  // ===== Internal normalization for numerical stability =====
  const yMax = Math.max(...data.map(p => Math.abs(p.y)));
  const normFactor = yMax > 0 ? yMax : 1;
  const normData = data.map(p => ({ x: p.x, y: p.y / normFactor }));
  
  // Choose initial parameters
  let workInitials: number[];
  let workBounds: { min: number[]; max: number[] };
  
  if (useSmartInitials) {
    const estimated = estimateInitialParams(normData, modelType, useIRF);
    workInitials = estimated.initial;
    workBounds = estimated.bounds;
  } else {
    workInitials = normalizeParams(initialParams, modelType, normFactor);
    workBounds = normalizeBounds(bounds, modelType, normFactor);
  }
  
  // Compute model values in normalized space
  // For direct fitting: modelFn(t - t0, params) — time shifted
  // For reconvolution: convolveWithIRF uses absolute time
  function computeNormModelValues(targetTimeAxis: number[], params: number[], targetT0?: number): number[] {
    if (useIRF && irfData) {
      // Reconvolution: use absolute time for IRF convolution
      return convolveWithIRF(modelFn, params, targetTimeAxis, irfData);
    } else {
      // Direct fitting: use shifted time t' = t - t₀
      const offset = targetT0 ?? t0;
      return targetTimeAxis.map(t => modelFn(t - offset, params));
    }
  }
  
  // Residuals in normalized space (using shifted time for direct fitting)
  function residualsFn(params: number[]): number[] {
    const modelValues = computeNormModelValues(timeAxis, params);
    return normData.map((p, i) => p.y - (modelValues[i] ?? 0));
  }
  
  // Run LM optimization
  let fittedParams = minimizeLM(workInitials, residualsFn, workBounds);
  
  // Check result quality; if R² < 0.5, try with different initial guesses
  let fittedNormValues = computeNormModelValues(timeAxis, fittedParams);
  const rSq = computeRSquared(normData, fittedNormValues);
  
  if (rSq < 0.5) {
    const altInitials = [...workInitials];
    if (modelType === 'bi-exp' && altInitials.length >= 5) {
      [altInitials[0], altInitials[2]] = [altInitials[2], altInitials[0]];
      [altInitials[1], altInitials[3]] = [altInitials[3], altInitials[1]];
    } else if (modelType === 'tri-exp' && altInitials.length >= 7) {
      const total = altInitials[0] + altInitials[2] + altInitials[4];
      altInitials[0] = total * 0.3;
      altInitials[2] = total * 0.4;
      altInitials[4] = total * 0.3;
    }
    const altParams = minimizeLM(altInitials, residualsFn, workBounds);
    const altNormValues = computeNormModelValues(timeAxis, altParams);
    const altRSq = computeRSquared(normData, altNormValues);
    if (altRSq > rSq) {
      fittedParams = altParams;
      fittedNormValues = altNormValues;
    }
  }
  
  // ===== Un-normalize parameters back to physical units =====
  const realParams = unnormalizeParams(fittedParams, modelType, normFactor);
  const realBounds = unnormalizeBounds(workBounds, modelType, normFactor);
  
  // Compute real-space fitted curve
  const realFittedValues = data.map((p, i) => fittedNormValues[i] * normFactor);
  const fittedCurve = timeAxis.map((t, i) => ({ x: t, y: realFittedValues[i] }));
  const residuals = data.map((p, i) => ({ x: p.x, y: p.y - realFittedValues[i] }));
  
  // Full time axis fitted curve (only in fit range)
  let fullFittedCurve: DataPoint[] | undefined;
  if (fullTimeAxis && fullTimeAxis.length > 0) {
    const startTime = fitRange?.start ?? data[0]?.x ?? 0;
    const endTime = fitRange?.end ?? data[data.length - 1]?.x ?? Infinity;
    const fullNormValues = computeNormModelValues(fullTimeAxis, fittedParams);
    fullFittedCurve = fullTimeAxis.map((t, i) => ({
      x: t,
      y: (t >= startTime && t <= endTime) ? fullNormValues[i] * normFactor : NaN,
    }));
  }
  
  const chiSquared = computeChiSquared(residuals.map(r => r.y), data);
  const rSquared = computeRSquared(data, realFittedValues);
  
  // Build parameter output — include t₀ if direct fitting
  const paramNames = getParamNames(modelType, customParamNames);
  const parameters: FitParameter[] = realParams.map((val, i) => ({
    name: paramNames[i] || `p${i + 1}`,
    value: val,
    min: realBounds.min[i],
    max: realBounds.max[i],
  }));
  
  return {
    modelType,
    parameters,
    fittedCurve,
    fullFittedCurve,
    residuals,
    chiSquared,
    rSquared,
    useIRF,
    customExpression,
    fitRange,
    timeOffset: !useIRF ? t0 : undefined,
  };
}

// ===== Parameter Normalization =====
// Amplitudes (A) and baseline (C) are divided by normFactor
// Time constants (τ) are unchanged

function normalizeParams(params: number[], modelType: FitModelType, normFactor: number): number[] {
  const result = [...params];
  const ampIndices = getAmplitudeIndices(modelType);
  const baselineIndex = getBaselineIndex(modelType);
  
  for (const i of ampIndices) {
    if (i < result.length) result[i] = result[i] / normFactor;
  }
  if (baselineIndex !== null && baselineIndex < result.length) {
    result[baselineIndex] = result[baselineIndex] / normFactor;
  }
  return result;
}

function unnormalizeParams(params: number[], modelType: FitModelType, normFactor: number): number[] {
  const result = [...params];
  const ampIndices = getAmplitudeIndices(modelType);
  const baselineIndex = getBaselineIndex(modelType);
  
  for (const i of ampIndices) {
    if (i < result.length) result[i] = result[i] * normFactor;
  }
  if (baselineIndex !== null && baselineIndex < result.length) {
    result[baselineIndex] = result[baselineIndex] * normFactor;
  }
  return result;
}

function normalizeBounds(bounds: { min: number[]; max: number[] }, modelType: FitModelType, normFactor: number): { min: number[]; max: number[] } {
  const min = [...bounds.min];
  const max = [...bounds.max];
  const ampIndices = getAmplitudeIndices(modelType);
  const baselineIndex = getBaselineIndex(modelType);
  
  for (const i of ampIndices) {
    if (i < min.length) min[i] = min[i] / normFactor;
    if (i < max.length) max[i] = max[i] / normFactor;
  }
  if (baselineIndex !== null) {
    if (baselineIndex < min.length) min[baselineIndex] = min[baselineIndex] / normFactor;
    if (baselineIndex < max.length) max[baselineIndex] = max[baselineIndex] / normFactor;
  }
  return { min, max };
}

function unnormalizeBounds(bounds: { min: number[]; max: number[] }, modelType: FitModelType, normFactor: number): { min: number[]; max: number[] } {
  const min = [...bounds.min];
  const max = [...bounds.max];
  const ampIndices = getAmplitudeIndices(modelType);
  const baselineIndex = getBaselineIndex(modelType);
  
  for (const i of ampIndices) {
    if (i < min.length) min[i] = min[i] * normFactor;
    if (i < max.length) max[i] = max[i] * normFactor;
  }
  if (baselineIndex !== null) {
    if (baselineIndex < min.length) min[baselineIndex] = min[baselineIndex] * normFactor;
    if (baselineIndex < max.length) max[baselineIndex] = max[baselineIndex] * normFactor;
  }
  return { min, max };
}

function getAmplitudeIndices(modelType: FitModelType): number[] {
  switch (modelType) {
    case 'mono-exp': return [0];
    case 'bi-exp': return [0, 2];
    case 'tri-exp': return [0, 2, 4];
    case 'power-law': return [0];
    case 'stretched-exp': return [0];
    default: return [];
  }
}

function getBaselineIndex(modelType: FitModelType): number | null {
  switch (modelType) {
    case 'mono-exp': return 2;
    case 'bi-exp': return 4;
    case 'tri-exp': return 6;
    case 'power-law': return 2;
    case 'stretched-exp': return 3;
    default: return null;
  }
}

// ===== Helpers =====

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

export function calculateAverageLifetime(parameters: FitParameter[], modelType: FitModelType): number | null {
  if (modelType === 'mono-exp') {
    const tau = parameters.find(p => p.name.includes('τ'));
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
        bounds: { min: [0, 0.01, -1e10], max: [1e12, 1e5, 1e10] },
      };
    case 'bi-exp':
      return {
        initial: [0.6, 2.0, 0.4, 10.0, 0.0],
        bounds: { min: [0, 0.01, 0, 0.01, -1e10], max: [1e12, 1e5, 1e12, 1e5, 1e10] },
      };
    case 'tri-exp':
      return {
        initial: [0.4, 1.0, 0.4, 5.0, 0.2, 20.0, 0.0],
        bounds: { min: [0, 0.01, 0, 0.01, 0, 0.01, -1e10], max: [1e12, 1e5, 1e12, 1e5, 1e12, 1e5, 1e10] },
      };
    case 'power-law':
      return {
        initial: [1.0, 1.0, 0.0],
        bounds: { min: [0, 0.01, -1e10], max: [1e12, 10, 1e10] },
      };
    case 'stretched-exp':
      return {
        initial: [1.0, 5.0, 0.8, 0.0],
        bounds: { min: [0, 0.01, 0.01, -1e10], max: [1e12, 1e5, 1.0, 1e10] },
      };
    default:
      return { initial: [1.0, 1.0, 0.0], bounds: { min: [0, 0, 0], max: [1e12, 1e12, 1e10] } };
  }
}
