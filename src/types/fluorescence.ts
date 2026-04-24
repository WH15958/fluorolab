// ===== Data Types =====

export interface DataPoint {
  x: number;
  y: number;
}

export interface FluorescenceDataset {
  id: string;
  name: string;
  type: 'steady-state' | 'transient';
  rawData: DataPoint[];
  xLabel: string;
  yLabel: string;
}

export interface IRFDataset {
  id: string;
  name: string;
  data: DataPoint[];
}

// ===== Fit Types =====

export type FitModelType =
  | 'mono-exp'
  | 'bi-exp'
  | 'tri-exp'
  | 'power-law'
  | 'stretched-exp'
  | 'custom';

export interface FitParameter {
  name: string;
  value: number;
  min?: number;
  max?: number;
  fixed?: boolean;
}

export interface FitResult {
  modelType: FitModelType;
  parameters: FitParameter[];
  fittedCurve: DataPoint[];
  residuals: DataPoint[];
  chiSquared: number;
  rSquared: number;
  useIRF: boolean;
  customExpression?: string;
}

// ===== Steady State Analysis =====

export interface SteadyStateAnalysis {
  peakWavelength: number;
  peakIntensity: number;
  fwhm: number;
  centroid: number;
  integratedIntensity: number;
}

// ===== Peak Fitting =====

export type PeakShape = 'gaussian' | 'lorentzian' | 'voigt';

export interface PeakParams {
  id: string;
  amplitude: number;
  center: number;
  fwhm: number;
  shape: PeakShape;
  mu: number; // Voigt mixing parameter (0=Gaussian, 1=Lorentzian)
}

export interface PeakFitResult {
  peaks: PeakParams[];
  baseline: number;
  fittedCurve: DataPoint[];
  residuals: DataPoint[];
  rSquared: number;
  reducedChiSq: number;
  totalArea: number;
}

export interface DetectedPeak {
  center: number;
  amplitude: number;
  fwhm: number;
}

// ===== UI State =====
export type ActiveTab = 'upload' | 'steady-state' | 'transient';
