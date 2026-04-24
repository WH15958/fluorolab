import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, BarChart, Bar,
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

interface FitConfig {
  modelType: FitModelType;
  useIRF: boolean;
  irfId: string;
  logScale: boolean;
  customExpression: string;
  customParams: string; // comma-separated names
  // Per-param override
  paramInitials: number[];
  paramMins: number[];
  paramMaxs: number[];
}

const MODEL_OPTIONS: { value: FitModelType; label: string; formula: string; nparams: number }[] = [
  { value: 'mono-exp', label: '单指数衰减', formula: 'A₁·exp(-t/τ₁) + C', nparams: 3 },
  { value: 'bi-exp', label: '双指数衰减', formula: 'A₁·exp(-t/τ₁) + A₂·exp(-t/τ₂) + C', nparams: 5 },
  { value: 'tri-exp', label: '三指数衰减', formula: 'A₁·exp(-t/τ₁) + A₂·exp(-t/τ₂) + A₃·exp(-t/τ₃) + C', nparams: 7 },
  { value: 'stretched-exp', label: '拉伸指数', formula: 'A·exp(-(t/τ)^β) + C', nparams: 4 },
  { value: 'power-law', label: '幂律函数', formula: 'A·t^(-β) + C', nparams: 3 },
  { value: 'custom', label: '自定义函数', formula: '用户自定义', nparams: 0 },
];

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#1E293B', borderRadius: 12, padding: 20,
      border: '1px solid #334155', ...style
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
    background: '#0F172A', border: '1px solid #334155', borderRadius: 6,
    color: '#F8FAFC', padding: '4px 8px', fontFamily: 'Roboto Mono, monospace',
    fontSize: 12, width: '100%',
  };

  return (
    <tr style={{ borderBottom: '1px solid #0F172A' }}>
      <td style={{ padding: '7px 8px', color: '#38BDF8', fontSize: 13, fontFamily: 'Roboto Mono', fontWeight: 500, whiteSpace: 'nowrap' }}>
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
      logScale: true,
      customExpression: 'A * Math.exp(-t / tau) + C',
      customParams: 'A,tau,C',
      paramInitials: def.initial,
      paramMins: def.bounds.min,
      paramMaxs: def.bounds.max,
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

  const runFit = useCallback(async () => {
    if (!selectedDataset) return;
    setFitting(true);
    setFitError(null);

    try {
      // Use requestAnimationFrame to allow UI update
      await new Promise((r) => setTimeout(r, 50));

      const result = fitTransientDecay(selectedDataset.rawData, {
        modelType: fitConfig.modelType,
        initialParams: fitConfig.paramInitials,
        bounds: { min: fitConfig.paramMins, max: fitConfig.paramMaxs },
        irfData: fitConfig.useIRF && selectedIRF ? selectedIRF.data : null,
        customExpression: fitConfig.customExpression,
        customParamNames: customParamNames,
      });

      setFitResult(result);
    } catch (e: any) {
      setFitError(e.message || '拟合失败');
    } finally {
      setFitting(false);
    }
  }, [selectedDataset, fitConfig, selectedIRF, customParamNames]);

  // Chart data: merge raw + fitted + IRF
  // Log scale needs positive values — filter out zeros/negatives and auto-switch if needed
  const chartData = useMemo(() => {
    if (!selectedDataset) return [];
    return selectedDataset.rawData.map((p, i) => {
      // Skip invalid y values for log scale rendering (will show as gaps)
      const row: Record<string, number | null> = { x: p.x, raw: p.y };
      if (fitResult) row.fitted = fitResult.fittedCurve[i]?.y ?? null;
      if (fitConfig.useIRF && selectedIRF) {
        const irf = selectedIRF.data.find((d) => Math.abs(d.x - p.x) < 0.01);
        if (irf) row.irf = irf.y;
      }
      return row;
    });
  }, [selectedDataset, fitResult, fitConfig.useIRF, selectedIRF]);

  const avgLifetime = fitResult ? calculateAverageLifetime(fitResult.parameters, fitResult.modelType) : null;

  // Auto-disable log scale when data has zeros/negatives (useEffect avoids infinite loop)
  const hasInvalidData = selectedDataset?.rawData.some((p) => p.y <= 0) ?? false;
  useEffect(() => {
    if (hasInvalidData && fitConfig.logScale) {
      setFitConfig((p) => ({ ...p, logScale: false }));
    }
  }, [hasInvalidData, fitConfig.logScale]);

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
                width: '100%', background: '#0F172A', border: '1px solid #334155',
                borderRadius: 8, color: '#F8FAFC', padding: '8px 10px', fontSize: 13,
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
                      background: isActive ? 'rgba(167, 139, 250, 0.15)' : 'rgba(15, 23, 42, 0.5)',
                      border: `1px solid ${isActive ? '#A78BFA' : '#334155'}`,
                      color: isActive ? '#A78BFA' : '#94A3B8',
                      cursor: 'pointer',
                      fontSize: 13, fontFamily: 'Exo, sans-serif',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontWeight: isActive ? 600 : 400 }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: '#475569', fontFamily: 'Roboto Mono, monospace', marginTop: 2 }}>
                      {m.formula}
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
                    width: '100%', background: '#0F172A', border: '1px solid #334155',
                    borderRadius: 6, color: '#38BDF8', padding: '8px', fontSize: 12,
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
                    width: '100%', background: '#0F172A', border: '1px solid #334155',
                    borderRadius: 6, color: '#F8FAFC', padding: '6px 8px', fontSize: 12,
                    fontFamily: 'Roboto Mono, monospace',
                  }}
                  placeholder="A,tau,C"
                />
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  可使用 Math.exp / Math.pow / Math.log 等内置函数
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
              <span style={{ fontSize: 13, fontWeight: 600, color: fitConfig.useIRF ? '#F59E0B' : '#94A3B8' }}>
                使用 IRF 卷积拟合
              </span>
            </label>
            {fitConfig.useIRF && (
              <select
                value={fitConfig.irfId}
                onChange={(e) => setFitConfig((p) => ({ ...p, irfId: e.target.value }))}
                style={{
                  width: '100%', background: '#0F172A', border: '1px solid #334155',
                  borderRadius: 8, color: '#F8FAFC', padding: '7px 10px', fontSize: 13, cursor: 'pointer',
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
                color: '#94A3B8', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0,
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
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['参数', '初始值', '最小值', '最大值'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: '#64748B', fontWeight: 500 }}>{h}</th>
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
              background: fitting ? '#334155' : 'linear-gradient(135deg, #7C3AED, #38BDF8)',
              border: 'none', color: 'white', fontSize: 15, fontWeight: 600,
              cursor: fitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: fitting ? 'none' : '0 4px 20px rgba(56, 189, 248, 0.3)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#94A3B8' }}>
              <input
                type="checkbox"
                checked={fitConfig.logScale}
                onChange={(e) => setFitConfig((p) => ({ ...p, logScale: e.target.checked }))}
                style={{ accentColor: '#A78BFA', width: 14, height: 14 }}
              />
              对数 Y 轴
            </label>

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
                      borderRadius: 6, background: '#1E293B', border: '1px solid #334155',
                      color: '#94A3B8', fontSize: 12, cursor: 'pointer',
                    }}
                    title="导出数据为 CSV"
                  >
                    <Download size={12} /> 导出数据
                  </button>
                  <button
                    onClick={() => exportChartPNG(chartRef.current, `transient_${Date.now()}.png`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
                      borderRadius: 6, background: '#1E293B', border: '1px solid #334155',
                      color: '#94A3B8', fontSize: 12, cursor: 'pointer',
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis
                      dataKey="x"
                      tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                      label={{ value: selectedDataset?.xLabel || 'Time (ns)', position: 'insideBottom', offset: -15, fill: '#64748B', fontSize: 12 }}
                      stroke="#334155"
                    />
                    <YAxis
                      scale={fitConfig.logScale ? 'log' : 'linear'}
                      domain={fitConfig.logScale ? ['auto', 'auto'] : [0, 'auto']}
                      tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                      label={{ value: 'Counts', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 12 }}
                      stroke="#334155"
                    />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8, fontSize: 12, fontFamily: 'Roboto Mono' }}
                    />
                    <Legend formatter={(value) => {
                      const map: Record<string, string> = { raw: '原始数据', fitted: '拟合曲线', irf: 'IRF' };
                      return <span style={{ fontSize: 12, color: '#CBD5E1' }}>{map[value] || value}</span>;
                    }} />
                    <Line dataKey="raw" stroke="#38BDF8" dot={false} strokeWidth={1.5} name="raw" isAnimationActive={false} connectNulls={!fitConfig.logScale} />
                    {fitResult && (
                      <Line dataKey="fitted" stroke="#F59E0B" dot={false} strokeWidth={2.5} name="fitted" strokeDasharray="6 2" isAnimationActive={false} connectNulls />
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
                    background: '#1E293B', borderRadius: 10, padding: '14px 16px',
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
                    <span style={{ fontSize: 11, color: '#F59E0B', background: 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', borderRadius: 20, marginLeft: 6 }}>
                      已使用 IRF 卷积
                    </span>
                  )}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Roboto Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['参数', '拟合值', '物理意义'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '7px 12px', color: '#64748B', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fitResult.parameters.map((param, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #0F172A' }}>
                        <td style={{ padding: '9px 12px', color: '#A78BFA', fontWeight: 600 }}>{param.name}</td>
                        <td style={{ padding: '9px 12px', color: '#F8FAFC' }}>{param.value.toPrecision(6)}</td>
                        <td style={{ padding: '9px 12px', color: '#64748B', fontSize: 12 }}>
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
                    <XAxis dataKey="x" tick={{ fill: '#64748B', fontSize: 10 }} stroke="#334155" />
                    <YAxis tick={{ fill: '#64748B', fontSize: 10 }} stroke="#334155" />
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <ReferenceLine y={0} stroke="#334155" />
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
