import React, { useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, BarChart, Bar,
} from 'recharts';
import {
  Zap, Play, RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Settings2,
  Download, Image,
} from 'lucide-react';
import type { FluorescenceDataset, IRFDataset, FitResult, FitModelType } from '../types/fluorescence';
import { fitTransientDecay, getDefaultParams, calculateAverageLifetime } from '../utils/fittingEngine';
import { exportChartPNG, exportMultiDatasetCSV } from '../utils/steadyStateAnalysis';

interface TransientPanelProps {
  datasets: FluorescenceDataset[];
  irfDatasets: IRFDataset[];
}

interface AxisRange {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

interface FitConfig {
  modelType: FitModelType;
  useIRF: boolean;
  irfId: string;
  logScale: boolean;
  xLogScale: boolean;
  normalize: boolean;
  customExpression: string;
  customParams: string; // comma-separated names
  // Per-param override
  paramInitials: number[];
  paramMins: number[];
  paramMaxs: number[];
  // Axis ranges
  axisRange: AxisRange;
  // Fitting time range (ns)
  fitRangeStart: number | null;
  fitRangeEnd: number | null;
  // Time offset t₀ for direct fitting
  timeOffset: number | null;
}

const MODEL_OPTIONS: { value: FitModelType; label: string; formula: string; formulaWithOffset: string; nparams: number }[] = [
  { value: 'mono-exp', label: '单指数衰减', formula: 'A₁·exp(-t/τ₁) + C', formulaWithOffset: 'A₁·exp(-(t-t₀)/τ₁) + C', nparams: 3 },
  { value: 'bi-exp', label: '双指数衰减', formula: 'A₁·exp(-t/τ₁) + A₂·exp(-t/τ₂) + C', formulaWithOffset: 'A₁·exp(-(t-t₀)/τ₁) + A₂·exp(-(t-t₀)/τ₂) + C', nparams: 5 },
  { value: 'tri-exp', label: '三指数衰减', formula: 'A₁·exp(-t/τ₁) + A₂·exp(-t/τ₂) + A₃·exp(-t/τ₃) + C', formulaWithOffset: 'A₁·exp(-(t-t₀)/τ₁) + A₂·exp(-(t-t₀)/τ₂) + A₃·exp(-(t-t₀)/τ₃) + C', nparams: 7 },
  { value: 'stretched-exp', label: '拉伸指数', formula: 'A·exp(-(t/τ)^β) + C', formulaWithOffset: 'A·exp(-((t-t₀)/τ)^β) + C', nparams: 4 },
  { value: 'power-law', label: '幂律函数', formula: 'A·t^(-β) + C', formulaWithOffset: 'A·(t-t₀)^(-β) + C', nparams: 3 },
  { value: 'custom', label: '自定义函数', formula: '用户自定义', formulaWithOffset: '用户自定义', nparams: 0 },
];

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 12, padding: 20,
      border: '1px solid #E2E8F0', ...style
    }}>
      {children}
    </div>
  );
}

function ParamRow({
  name, value, min, max,
  onValue, onMin, onMax,
}: {
  name: string; value: number; min: number; max: number;
  onValue: (v: number) => void; onMin: (v: number) => void; onMax: (v: number) => void;
}) {
  const inputStyle: React.CSSProperties = {
    background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6,
    color: '#0F172A', padding: '4px 8px', fontFamily: 'Roboto Mono, monospace',
    fontSize: 12, width: '100%',
  };

  return (
    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
      <td style={{ padding: '7px 8px', color: '#2563EB', fontSize: 13, fontFamily: 'Roboto Mono', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {name}
      </td>
      <td style={{ padding: '7px 8px' }}>
        <input type="number" value={value} onChange={(e) => onValue(+e.target.value)} style={inputStyle} />
      </td>
      <td style={{ padding: '7px 8px' }}>
        <input type="number" value={min} onChange={(e) => onMin(+e.target.value)} style={inputStyle} />
      </td>
      <td style={{ padding: '7px 8px' }}>
        <input type="number" value={max} onChange={(e) => onMax(+e.target.value)} style={inputStyle} />
      </td>
    </tr>
  );
}

function getParamNames(modelType: FitModelType, customNames: string[]): string[] {
  switch (modelType) {
    case 'mono-exp': return ['A₁', 'τ₁', 'C'];
    case 'bi-exp': return ['A₁', 'τ₁', 'A₂', 'τ₂', 'C'];
    case 'tri-exp': return ['A₁', 'τ₁', 'A₂', 'τ₂', 'A₃', 'τ₃', 'C'];
    case 'power-law': return ['A', 'β', 'C'];
    case 'stretched-exp': return ['A', 'τ', 'β', 'C'];
    case 'custom': return customNames;
    default: return [];
  }
}

export default function TransientPanel({ datasets, irfDatasets }: TransientPanelProps) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [fitConfig, setFitConfig] = useState<FitConfig>(() => {
    const def = getDefaultParams('mono-exp');
    return {
      modelType: 'mono-exp', useIRF: false, irfId: '',
      logScale: true, xLogScale: false, normalize: false,
      customExpression: 'A * Math.exp(-t / tau) + C',
      customParams: 'A,tau,C',
      paramInitials: def.initial,
      paramMins: def.bounds.min,
      paramMaxs: def.bounds.max,
      axisRange: { xMin: null, xMax: null, yMin: null, yMax: null },
      fitRangeStart: null,
      fitRangeEnd: null,
      timeOffset: null,
    };
  });
  const [fitResult, setFitResult] = useState<FitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId) || datasets[0];
  const selectedIRF = irfDatasets.find((d) => d.id === fitConfig.irfId);

  // Update params when model changes
  const handleModelChange = useCallback((modelType: FitModelType) => {
    const def = getDefaultParams(modelType);
    setFitConfig((prev) => ({
      ...prev,
      modelType,
      paramInitials: def.initial,
      paramMins: def.bounds.min,
      paramMaxs: def.bounds.max,
    }));
    setFitResult(null);
  }, []);

  const customParamNames = fitConfig.customParams.split(',').map((s) => s.trim()).filter(Boolean);
  const paramNames = getParamNames(fitConfig.modelType, customParamNames);

  // Handle custom model param count changes
  const handleCustomParamsChange = (val: string) => {
    const names = val.split(',').map((s) => s.trim()).filter(Boolean);
    const n = names.length;
    setFitConfig((prev) => ({
      ...prev,
      customParams: val,
      paramInitials: Array(n).fill(1.0),
      paramMins: Array(n).fill(0),
      paramMaxs: Array(n).fill(1e6),
    }));
  };

  const runFit = async () => {
    if (!selectedDataset) return;
    setFitting(true);
    setFitError(null);

    try {
      await new Promise((r) => setTimeout(r, 50));

      let fitData = selectedDataset.rawData;
      if (fitConfig.fitRangeStart !== null || fitConfig.fitRangeEnd !== null) {
        fitData = fitData.filter((p) => {
          if (fitConfig.fitRangeStart !== null && p.x < fitConfig.fitRangeStart) return false;
          if (fitConfig.fitRangeEnd !== null && p.x > fitConfig.fitRangeEnd) return false;
          return true;
        });
      }

      if (fitData.length < 3) {
        throw new Error('拟合数据点不足，请调整拟合范围');
      }

      const useIRF = fitConfig.useIRF && !!selectedIRF;

      const result = fitTransientDecay(fitData, {
        modelType: fitConfig.modelType,
        initialParams: fitConfig.paramInitials,
        bounds: { min: fitConfig.paramMins, max: fitConfig.paramMaxs },
        irfData: useIRF ? selectedIRF!.data : null,
        customExpression: fitConfig.customExpression,
        customParamNames: customParamNames,
        fullTimeAxis: selectedDataset.rawData.map((p) => p.x),
        fitRange: { start: fitConfig.fitRangeStart, end: fitConfig.fitRangeEnd },
        useSmartInitials: true,
        timeOffset: !useIRF ? (fitConfig.timeOffset ?? undefined) : undefined,
      });

      setFitResult(result);
    } catch (e: unknown) {
      setFitError(e instanceof Error ? e.message : '拟合失败');
    } finally {
      setFitting(false);
    }
  };

  // Chart data: merge raw + fitted + IRF with optional normalization
  // Use fullFittedCurve (on full time axis) if available, otherwise fittedCurve

  const xShift = !fitConfig.xLogScale || !selectedDataset ? 0
    : Math.min(...selectedDataset.rawData.map((p) => p.x)) < 0
      ? -Math.min(...selectedDataset.rawData.map((p) => p.x)) + 1 : 0;

  function computeChartData(): Record<string, number | null>[] {
    if (!selectedDataset) return [];
    const raw = selectedDataset.rawData;
    const maxY = fitConfig.normalize ? Math.max(...raw.map((p) => p.y)) : 1;

    const fullCurve = fitResult?.fullFittedCurve;
    const partialCurve = fitResult?.fittedCurve;

    const fitStart = fitResult?.fitRange?.start ?? fitConfig.fitRangeStart;
    const fitEnd = fitResult?.fitRange?.end ?? fitConfig.fitRangeEnd;

    const partialMap = !fullCurve && partialCurve
      ? new Map(partialCurve.map((pt) => [pt.x, pt.y]))
      : null;

    return raw.map((p) => {
      const yNorm = maxY > 0 ? p.y / maxY : p.y;
      const xDisplay = fitConfig.xLogScale ? p.x + xShift : p.x;
      const row: Record<string, number | null> = { x: xDisplay, raw: yNorm };
      if (fitResult) {
        let fyRaw: number | undefined;
        if (fullCurve) {
          const matched = fullCurve.find((pt) => Math.abs(pt.x - p.x) < 1e-9);
          fyRaw = matched?.y;
        } else if (partialMap) {
          fyRaw = partialMap.get(p.x);
        }
        const fy = fitConfig.normalize && maxY > 0 && fyRaw != null ? fyRaw / maxY : fyRaw;
        const inRange = (fitStart == null || p.x >= fitStart) && (fitEnd == null || p.x <= fitEnd);
        row.fitted = (fy != null && !isNaN(fy) && inRange) ? fy : null;
      }
      if (fitConfig.useIRF && selectedIRF) {
        const irf = selectedIRF.data.find((d) => Math.abs(d.x - p.x) < 0.01);
        if (irf) row.irf = irf.y;
      }
      return row;
    });
  }
  const chartData = computeChartData();

  const avgLifetime = fitResult ? calculateAverageLifetime(fitResult.parameters, fitResult.modelType) : null;

  const hasInvalidData = selectedDataset?.rawData.some((p) => p.y <= 0) ?? false;

  if (datasets.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 24px', color: '#64748B' }}>
        <Zap size={48} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
        <p style={{ fontSize: 16, marginBottom: 8 }}>尚未上传瞬态荧光数据</p>
        <p style={{ fontSize: 13 }}>请先在「数据上传」页面上传 TCSPC/TRPL 文件</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1280, margin: '0 auto' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>瞬态荧光分析</h2>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>
        多指数衰减拟合 · IRF 卷积去卷积 · 幂律/拉伸指数/自定义函数
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        {/* Config Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Dataset Select */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', marginBottom: 10 }}>选择数据集</div>
            <select
              value={selectedDataset?.id || ''}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              style={{
                width: '100%', background: '#FFFFFF', border: '1px solid #E2E8F0',
                borderRadius: 8, color: '#0F172A', padding: '8px 10px', fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>{ds.name}</option>
              ))}
            </select>
          </Card>

          {/* Model Select */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', marginBottom: 10 }}>拟合模型</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {MODEL_OPTIONS.map((m) => {
                const isActive = fitConfig.modelType === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => handleModelChange(m.value)}
                    style={{
                      textAlign: 'left', padding: '9px 12px', borderRadius: 8,
                      background: isActive ? 'rgba(124, 58, 237, 0.1)' : '#F8FAFC',
                      border: `1px solid ${isActive ? '#7C3AED' : '#E2E8F0'}`,
                      color: isActive ? '#7C3AED' : '#64748B',
                      cursor: 'pointer',
                      fontSize: 13, fontFamily: 'Exo, sans-serif',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontWeight: isActive ? 600 : 400 }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'Roboto Mono, monospace', marginTop: 2 }}>
                      {!fitConfig.useIRF && fitConfig.fitRangeStart != null ? m.formulaWithOffset : m.formula}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom expression input */}
            {fitConfig.modelType === 'custom' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>函数表达式（使用 t 作为时间变量）</div>
                <textarea
                  value={fitConfig.customExpression}
                  onChange={(e) => setFitConfig((p) => ({ ...p, customExpression: e.target.value }))}
                  rows={3}
                  style={{
                    width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0',
                    borderRadius: 6, color: '#2563EB', padding: '8px', fontSize: 12,
                    fontFamily: 'Roboto Mono, monospace', resize: 'vertical',
                  }}
                  placeholder="A * Math.exp(-t / tau) + C"
                />
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4, marginTop: 8 }}>参数名（逗号分隔）</div>
                <input
                  type="text"
                  value={fitConfig.customParams}
                  onChange={(e) => handleCustomParamsChange(e.target.value)}
                  style={{
                    width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0',
                    borderRadius: 6, color: '#0F172A', padding: '6px 8px', fontSize: 12,
                    fontFamily: 'Roboto Mono, monospace',
                  }}
                  placeholder="A,tau,C"
                />
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                   可使用 Math.exp / Math.pow / Math.log 等内置函数
                  </div>
              </div>
            )}
          </Card>

          {/* Fitting Range */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', marginBottom: 10 }}>
              拟合时间范围（ns）
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>起始时间</div>
                <input
                  type="number"
                  value={fitConfig.fitRangeStart ?? ''}
                  onChange={(e) => setFitConfig((p) => ({
                    ...p,
                    fitRangeStart: e.target.value === '' ? null : +e.target.value,
                  }))}
                  placeholder="如 0"
                  style={{
                    width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0',
                    borderRadius: 6, color: '#0F172A', padding: '6px 8px', fontSize: 12,
                    fontFamily: 'Roboto Mono',
                  }}
                />
              </div>
              <div style={{ color: '#475569', marginTop: 16 }}>—</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>结束时间</div>
                <input
                  type="number"
                  value={fitConfig.fitRangeEnd ?? ''}
                  onChange={(e) => setFitConfig((p) => ({
                    ...p,
                    fitRangeEnd: e.target.value === '' ? null : +e.target.value,
                  }))}
                  placeholder="如 100"
                  style={{
                    width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0',
                    borderRadius: 6, color: '#0F172A', padding: '6px 8px', fontSize: 12,
                    fontFamily: 'Roboto Mono',
                  }}
                />
              </div>
            </div>
            {selectedDataset && (
              <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                数据范围: {selectedDataset.rawData[0]?.x.toFixed(2)} — {selectedDataset.rawData[selectedDataset.rawData.length - 1]?.x.toFixed(2)} ns
              </div>
            )}
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              空表示使用全部数据
            </div>

            {/* Time offset t₀ — only for direct fitting (no IRF) */}
            {!fitConfig.useIRF && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(37, 99, 235, 0.04)', borderRadius: 8, border: '1px solid rgba(37, 99, 235, 0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#2563EB' }}>时间偏移 t₀</span>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>直接拟合时 t' = t − t₀</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    value={fitConfig.timeOffset ?? ''}
                    onChange={(e) => setFitConfig((p) => ({
                      ...p,
                      timeOffset: e.target.value === '' ? null : +e.target.value,
                    }))}
                    placeholder={fitConfig.fitRangeStart != null ? String(fitConfig.fitRangeStart) : '自动'}
                    style={{
                      flex: 1, background: '#F8FAFC', border: '1px solid #E2E8F0',
                      borderRadius: 6, color: '#0F172A', padding: '5px 8px', fontSize: 12,
                      fontFamily: 'Roboto Mono',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#475569' }}>ns</span>
                </div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
                   空表示自动使用起始时间；设置后 A 代表 t₀ 处的振幅
                  </div>
              </div>
            )}
          </Card>

          {/* IRF */}
          <Card>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={fitConfig.useIRF}
                onChange={(e) => setFitConfig((p) => ({ ...p, useIRF: e.target.checked }))}
                style={{ accentColor: '#F59E0B', width: 15, height: 15 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: fitConfig.useIRF ? '#F59E0B' : '#64748B' }}>
                使用 IRF 卷积拟合
              </span>
            </label>
            {fitConfig.useIRF && (
              <select
                value={fitConfig.irfId}
                onChange={(e) => {
                  const newIrfId = e.target.value;
                  const selectedIrf = irfDatasets.find((ds) => ds.id === newIrfId);
                  // Auto-set fitting start time to IRF peak position (after IRF)
                  let newFitRangeStart = fitConfig.fitRangeStart;
                  if (selectedIrf && selectedIrf.data.length > 0) {
                    const peakPoint = selectedIrf.data.reduce((max, p) => p.y > max.y ? p : max, selectedIrf.data[0]);
                    newFitRangeStart = Math.max(19, peakPoint.x); // Start fitting 19ns after IRF peak
                  }
                  setFitConfig((p) => ({ ...p, irfId: newIrfId, fitRangeStart: newFitRangeStart }));
                }}
                style={{
                  width: '100%', background: '#FFFFFF', border: '1px solid #E2E8F0',
                  borderRadius: 8, color: '#0F172A', padding: '7px 10px', fontSize: 13, cursor: 'pointer',
                }}
              >
                <option value="">-- 选择 IRF 文件 --</option>
                {irfDatasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name}</option>
                ))}
              </select>
            )}
            {fitConfig.useIRF && irfDatasets.length === 0 && (
              <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={12} /> 请先上传 IRF 文件
              </div>
            )}
          </Card>

          {/* Advanced: initial params */}
          <Card>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', background: 'none', border: 'none',
                color: '#64748B', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings2 size={14} /> 初始参数 & 边界
              </span>
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showAdvanced && paramNames.length > 0 && (
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                      {['参数', '初始值', '最小值', '最大值'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: '#94A3B8', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paramNames.map((name, i) => (
                      <ParamRow
                        key={i} name={name}
                        value={fitConfig.paramInitials[i] ?? 1}
                        min={fitConfig.paramMins[i] ?? 0}
                        max={fitConfig.paramMaxs[i] ?? 1e6}
                        onValue={(v) => setFitConfig((p) => {
                          const a = [...p.paramInitials]; a[i] = v; return { ...p, paramInitials: a };
                        })}
                        onMin={(v) => setFitConfig((p) => {
                          const a = [...p.paramMins]; a[i] = v; return { ...p, paramMins: a };
                        })}
                        onMax={(v) => setFitConfig((p) => {
                          const a = [...p.paramMaxs]; a[i] = v; return { ...p, paramMaxs: a };
                        })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Run button */}
          <button
            onClick={runFit}
            disabled={fitting || !selectedDataset}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 20px', borderRadius: 10,
              background: fitting ? '#CBD5E1' : 'linear-gradient(135deg, #7C3AED, #2563EB)',
              border: 'none', color: 'white', fontSize: 15, fontWeight: 600,
              cursor: fitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: fitting ? 'none' : '0 4px 20px rgba(37, 99, 235, 0.3)',
            }}
          >
            {fitting ? (
              <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> 拟合中…</>
            ) : (
              <><Play size={16} /> 开始拟合</>
            )}
          </button>

          {fitError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#EF4444',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertTriangle size={14} /> {fitError}
            </div>
          )}
        </div>

        {/* Right: Chart + Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Options row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            {/* Normalization */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#64748B' }}>
              <input
                type="checkbox"
                checked={fitConfig.normalize}
                onChange={(e) => setFitConfig((p) => ({ ...p, normalize: e.target.checked }))}
                style={{ accentColor: '#7C3AED', width: 14, height: 14 }}
              />
              归一化
            </label>

            {/* Log scale */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#64748B' }}>
              <input
                type="checkbox"
                checked={fitConfig.logScale}
                onChange={(e) => setFitConfig((p) => ({ ...p, logScale: e.target.checked }))}
                style={{ accentColor: '#7C3AED', width: 14, height: 14 }}
                disabled={fitConfig.normalize || hasInvalidData}
              />
              对数 Y 轴
            </label>

            {/* X Log scale */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#64748B' }}>
              <input
                type="checkbox"
                checked={fitConfig.xLogScale}
                onChange={(e) => setFitConfig((p) => ({ ...p, xLogScale: e.target.checked }))}
                style={{ accentColor: '#2563EB', width: 14, height: 14 }}
              />
              对数 X 轴
            </label>

            {/* Axis range controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <span style={{ fontSize: 11, color: '#475569' }}>X:</span>
              {(['xMin', 'xMax'] as const).map((field) => (
                <input
                  key={field}
                  type="number"
                  placeholder={field === 'xMin' ? 'min' : 'max'}
                  value={fitConfig.axisRange[field] ?? ''}
                  onChange={(e) => setFitConfig((p) => ({
                    ...p,
                    axisRange: { ...p.axisRange, [field]: e.target.value === '' ? null : +e.target.value },
                  }))}
                    style={{
                      width: 60, background: '#F8FAFC', border: '1px solid #E2E8F0',
                      borderRadius: 4, color: '#0F172A', padding: '2px 6px', fontSize: 11,
                      fontFamily: 'Roboto Mono',
                    }}
                />
              ))}
              <span style={{ fontSize: 11, color: '#475569' }}>Y:</span>
              {(['yMin', 'yMax'] as const).map((field) => (
                <input
                  key={field}
                  type="number"
                  placeholder={field === 'yMin' ? 'min' : 'max'}
                  value={fitConfig.axisRange[field] ?? ''}
                  onChange={(e) => setFitConfig((p) => ({
                    ...p,
                    axisRange: { ...p.axisRange, [field]: e.target.value === '' ? null : +e.target.value },
                  }))}
                    style={{
                      width: 60, background: '#F8FAFC', border: '1px solid #E2E8F0',
                      borderRadius: 4, color: '#0F172A', padding: '2px 6px', fontSize: 11,
                      fontFamily: 'Roboto Mono',
                    }}
                />
              ))}
            </div>

            {/* Export buttons */}
            {chartData.length > 0 && (
              <>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      const toExport = chartData.map((r) => ({ x: r.x, y: r.raw ?? 0 }));
                      const fittedExport = fitResult
                        ? chartData.map((r) => ({ x: r.x, y: r.fitted ?? 0 }))
                        : null;
                      const sets = [{ name: '原始数据', data: toExport }];
                      if (fittedExport) sets.push({ name: '拟合曲线', data: fittedExport });
                      exportMultiDatasetCSV(sets, `transient_${Date.now()}.csv`);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
                      borderRadius: 6, background: '#FFFFFF', border: '1px solid #E2E8F0',
                      color: '#64748B', fontSize: 12, cursor: 'pointer',
                    }}
                    title="导出数据为 CSV"
                  >
                    <Download size={12} /> 导出数据
                  </button>
                  <button
                    onClick={() => exportChartPNG(chartRef.current, `transient_${Date.now()}.png`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
                      borderRadius: 6, background: '#FFFFFF', border: '1px solid #E2E8F0',
                      color: '#64748B', fontSize: 12, cursor: 'pointer',
                    }}
                    title="导出图表为 PNG"
                  >
                    <Image size={12} /> 导出图片
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Main chart */}
          <Card>
            <div ref={chartRef}>
              {hasInvalidData && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 8, padding: '8px 12px', marginBottom: 10,
                  fontSize: 12, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <AlertTriangle size={13} />
                  数据含 0 或负值，已自动切换为线性坐标显示（对数坐标不支持 0/负值）
                </div>
              )}
              {chartData.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: 380, color: '#475569', gap: 12,
                }}>
                  <Zap size={36} style={{ opacity: 0.3 }} />
                  <p style={{ fontSize: 14, margin: 0 }}>暂无数据可视化</p>
                  <p style={{ fontSize: 12, margin: 0 }}>请上传瞬态荧光数据文件</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      dataKey="x"
                      scale={fitConfig.xLogScale ? 'log' : 'linear'}
                      domain={[
                        fitConfig.xLogScale
                          ? (fitConfig.axisRange.xMin != null ? Math.max(fitConfig.axisRange.xMin, 0.1) : 'auto')
                          : (fitConfig.axisRange.xMin ?? 'auto'),
                        fitConfig.axisRange.xMax ?? 'auto',
                      ]}
                      tick={<XTick />}
                      label={{ value: selectedDataset?.xLabel || 'Time (ns)', position: 'insideBottom', offset: -15, fill: '#94A3B8', fontSize: 12 }}
                      stroke="#E2E8F0"
                    />
                    <YAxis
                      scale={fitConfig.logScale ? 'log' : 'linear'}
                      domain={[
                        fitConfig.logScale ? 'auto' : (fitConfig.axisRange.yMin ?? 0),
                        fitConfig.axisRange.yMax ?? 'auto',
                      ]}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'Roboto Mono' }}
                      label={{ value: fitConfig.normalize ? 'Intensity (norm.)' : 'Counts', angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 12 }}
                      stroke="#E2E8F0"
                    />
                    <Tooltip
                      contentStyle={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontFamily: 'Roboto Mono' }}
                    />
                    <Legend formatter={(value) => {
                      const map: Record<string, string> = { raw: '原始数据', fitted: '拟合曲线', irf: 'IRF' };
                      return <span style={{ fontSize: 12, color: '#334155' }}>{map[value] || value}</span>;
                    }} />
                    {/* Highlight fitting range */}
                    {fitResult?.fitRange && (fitResult.fitRange.start !== null || fitResult.fitRange.end !== null) && (
                      <ReferenceArea
                        x1={fitResult.fitRange.start ?? undefined}
                        x2={fitResult.fitRange.end ?? undefined}
                        fill="rgba(167, 139, 250, 0.08)"
                        stroke="rgba(167, 139, 250, 0.3)"
                        strokeWidth={1}
                        ifOverflow="extendDomain"
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="raw"
                      stroke="#38BDF8"
                      dot={<CustomDot r={2} fill="#38BDF8" strokeWidth={0} />}
                      strokeWidth={1.5}
                      name="raw"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    {fitResult && (
                      <Line dataKey="fitted" stroke="#F59E0B" dot={false} strokeWidth={2.5} name="fitted" strokeDasharray="6 2" isAnimationActive={false} connectNulls={false} />
                    )}
                    {fitConfig.useIRF && selectedIRF && (
                      <Line dataKey="irf" stroke="#94A3B8" dot={false} strokeWidth={1} name="irf" isAnimationActive={false} connectNulls />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* Fit Results */}
          {fitResult && (
            <>
              {/* Quality Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {[
                  { label: 'R²', value: fitResult.rSquared.toFixed(6), color: fitResult.rSquared > 0.99 ? '#22C55E' : '#F59E0B' },
                  { label: 'χ² (reduced)', value: fitResult.chiSquared.toExponential(3), color: '#38BDF8' },
                  ...(avgLifetime !== null ? [{ label: '加权平均寿命 ⟨τ⟩', value: `${avgLifetime.toFixed(4)} ns`, color: '#A78BFA' }] : []),
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
                    border: `1px solid ${color}30`,
                  }}>
                    <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'Roboto Mono, monospace' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Parameters Table */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={15} color="#22C55E" /> 拟合参数结果
                  {fitResult.useIRF && (
                    <span style={{ fontSize: 11, color: '#F59E0B', background: 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', borderRadius: 20 }}>
                      IRF 卷积
                    </span>
                  )}
                  {fitResult.timeOffset != null && fitResult.timeOffset !== 0 && (
                    <span style={{ fontSize: 11, color: '#38BDF8', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: 20 }}>
                      t₀ = {fitResult.timeOffset.toFixed(2)} ns
                    </span>
                  )}
                  {fitResult.fitRange && (fitResult.fitRange.start !== null || fitResult.fitRange.end !== null) && (
                    <span style={{ fontSize: 11, color: '#A78BFA', background: 'rgba(167, 139, 250, 0.1)', padding: '2px 8px', borderRadius: 20 }}>
                      拟合范围: {fitResult.fitRange.start?.toFixed(2) ?? '-'} ~ {fitResult.fitRange.end?.toFixed(2) ?? '-'} ns
                    </span>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Roboto Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                      {['参数', '拟合值', '物理意义'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '7px 12px', color: '#94A3B8', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fitResult.parameters.map((param, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '9px 12px', color: '#7C3AED', fontWeight: 600 }}>{param.name}</td>
                        <td style={{ padding: '9px 12px', color: '#0F172A' }}>{param.value.toPrecision(6)}</td>
                        <td style={{ padding: '9px 12px', color: '#94A3B8', fontSize: 12 }}>
                          {getParamMeaning(param.name, fitResult.modelType)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Residuals */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>残差分析</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={fitResult.residuals.filter((_, i) => i % Math.max(1, Math.floor(fitResult.residuals.length / 200)) === 0)} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <XAxis dataKey="x" tick={{ fill: '#94A3B8', fontSize: 10 }} stroke="#E2E8F0" />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} stroke="#E2E8F0" />
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <ReferenceLine y={0} stroke="#CBD5E1" />
                    <Bar dataKey="y" fill="#38BDF8" opacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Tick formatter for X axis — clean labels like "10ns", "100ns"
// Renders as a custom tick component to avoid tickFormatter type issues in Recharts 3.x
function formatXAxisTick(val: unknown): string {
  const n = typeof val === 'number' && !isNaN(val) ? val : 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  if (n >= 1) return n % 1 === 0 ? `${n}` : n.toFixed(1);
  if (n >= 0.1) return n.toFixed(1);
  if (n >= 0.01) return n.toFixed(2);
  if (n <= 0) return String(n);
  return n.toExponential(1);
}

function XTick(props: { x?: number; y?: number; payload?: { value?: unknown; coordinate?: number }; index?: number; textAnchor?: string }) {
  const { x, y, payload, textAnchor } = props;
  const val = payload?.value;
  // Guard: if val is not a valid number, skip rendering
  if (val == null || (typeof val === 'number' && isNaN(val))) return null;
  return (
    <text
      x={x}
      y={y}
      dy={16}
      fill="#94A3B8"
      fontSize={12}
      fontFamily="Roboto Mono, monospace"
      textAnchor={textAnchor ?? 'middle'}
    >
      {formatXAxisTick(val)}
    </text>
  );
}

// Small dot renderer for raw data points — makes them visible even when overlaid by fitted curve
function CustomDot({ cx, cy, r, fill }: { cx?: number; cy?: number; r?: number; fill?: string }) {
  if (cx == null || cy == null || r == null) return null;
  return <circle cx={cx} cy={cy} r={r} fill={fill} />;
}

function getParamMeaning(name: string, model: FitModelType): string {
  if (name.startsWith('A')) return '振幅（归一化系数）';
  if (name.includes('τ') || name === 'tau' || name === 'τ') return '荧光寿命 (ns)';
  if (name === 'β' || name === 'beta') {
    if (model === 'stretched-exp') return '拉伸指数 (0<β≤1)';
    if (model === 'power-law') return '幂律指数';
  }
  if (name === 'C') return '背景/偏移量';
  return '';
}
