import { useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import {
  Activity, TrendingUp, BarChart2, Sliders,
  Download, Image, Zap, Play, Plus, Trash2,
} from 'lucide-react';
import type { FluorescenceDataset, PeakParams, PeakShape, PeakFitResult } from '../types/fluorescence';
import {
  analyzeSteadyState, normalizeData, subtractBaseline, smoothData,
  detectPeaks, fitPeaks, exportToCSV, exportMultiDatasetCSV,
  exportChartPNG,
} from '../utils/steadyStateAnalysis';

interface SteadyStatePanelProps {
  datasets: FluorescenceDataset[];
}

const COLORS = ['#38BDF8', '#A78BFA', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

interface ProcessingOptions {
  normalize: boolean;
  subtractBg: boolean;
  smooth: boolean;
  smoothWindow: number;
  logScale: boolean;
}

const SHAPE_LABELS: Record<PeakShape, string> = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  voigt: 'Pseudo-Voigt',
};

function makePeakId() {
  return Math.random().toString(36).slice(2);
}

function gaussianArea(A: number, fwhm: number): number {
  return A * (fwhm / 2.355) * Math.sqrt(2 * Math.PI);
}
function lorentzianArea(A: number, fwhm: number): number {
  return A * Math.PI * fwhm / 2;
}
function pseudoVoigtArea(A: number, fwhm: number, mu: number): number {
  return (1 - mu) * gaussianArea(A, fwhm) + mu * lorentzianArea(A, fwhm);
}

export default function SteadyStatePanel({ datasets }: SteadyStatePanelProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [opts, setOpts] = useState<ProcessingOptions>({
    normalize: false, subtractBg: false, smooth: false, smoothWindow: 5, logScale: false,
  });

  const [fitTargetId, setFitTargetId] = useState<string>('');
  const [peakCount, setPeakCount] = useState(1);
  const [peakShape, setPeakShape] = useState<PeakShape>('gaussian');
  const [manualPeaks, setManualPeaks] = useState<PeakParams[]>([]);
  const [fitResult, setFitResult] = useState<PeakFitResult | null>(null);
  const [fitLoading, setFitLoading] = useState(false);
  const [showResiduals, setShowResiduals] = useState(false);
  const [detectedPeaks, setDetectedPeaks] = useState<ReturnType<typeof detectPeaks>>([]);

  const activeDatasets = datasets.filter(
    (ds) => selectedIds.length === 0 || selectedIds.includes(ds.id),
  );

  const fitTarget = useMemo(
    () => datasets.find((ds) => ds.id === fitTargetId) ?? datasets[0] ?? null,
    [datasets, fitTargetId],
  );

  const processedDatasets = useMemo(
    () =>
      activeDatasets.map((ds) => {
        let data = [...ds.rawData];
        if (opts.subtractBg) data = subtractBaseline(data);
        if (opts.smooth) data = smoothData(data, opts.smoothWindow);
        if (opts.normalize) data = normalizeData(data);
        return { ...ds, processedData: data };
      }),
    [activeDatasets, opts],
  );

  const chartData = useMemo(() => {
    if (processedDatasets.length === 0) return [];
    const allX = new Set<number>();
    processedDatasets.forEach((ds) => ds.processedData.forEach((p) => allX.add(p.x)));
    const sortedX = Array.from(allX).sort((a, b) => a - b);
    return sortedX.map((x) => {
      const row: Record<string, number> = { x: Number(x.toFixed(3)) };
      processedDatasets.forEach((ds) => {
        const rawPt = ds.rawData.find((p) => Math.abs(p.x - x) < 1e-6);
        if (rawPt) {
          const v = opts.logScale && rawPt.y > 0 ? Math.log10(rawPt.y) : rawPt.y;
          row[ds.id] = v;
        }
      });
      return row;
    });
  }, [processedDatasets, opts.logScale]);

  const fitProcessedData = useMemo(() => {
    if (!fitTarget) return [];
    let data = [...fitTarget.rawData];
    if (opts.subtractBg) data = subtractBaseline(data);
    if (opts.smooth) data = smoothData(data, opts.smoothWindow);
    if (opts.normalize) data = normalizeData(data);
    return data;
  }, [fitTarget, opts]);

  const fitChartData = useMemo(() => {
    if (!fitTarget || !fitResult) return [];
    const xs = new Set<number>();
    fitProcessedData.forEach((p) => xs.add(p.x));
    fitResult.fittedCurve.forEach((p) => xs.add(p.x));
    const sorted = Array.from(xs).sort((a, b) => a - b);

    const key = fitTarget.id + '_fit';
    const keyRaw = fitTarget.id + '_raw';

    return sorted.map((x) => {
      const pt = fitProcessedData.find((p) => Math.abs(p.x - x) < 1e-6);
      const fitPt = fitResult.fittedCurve.find((p) => Math.abs(p.x - x) < 1e-6);
      const row: Record<string, number> = { x: Number(x.toFixed(3)) };
      if (pt) row[keyRaw] = pt.y;
      if (fitPt) row[key] = fitPt.y;

      fitResult.peaks.forEach((peak, pi) => {
        let val = 0;
        if (peak.shape === 'gaussian') {
          const sigma = peak.fwhm / 2.355;
          val = peak.amplitude * Math.exp(-((x - peak.center) ** 2) / (2 * sigma * sigma));
        } else if (peak.shape === 'lorentzian') {
          const g2 = (peak.fwhm / 2) ** 2;
          val = (peak.amplitude * g2) / ((x - peak.center) ** 2 + g2);
        } else {
          const sigma = peak.fwhm / 2.355;
          const g = peak.amplitude * Math.exp(-((x - peak.center) ** 2) / (2 * sigma * sigma));
          const g2 = (peak.fwhm / 2) ** 2;
          const l = (peak.amplitude * g2) / ((x - peak.center) ** 2 + g2);
          val = (1 - peak.mu) * g + peak.mu * l;
        }
        row[`peak_${pi}`] = val + fitResult.baseline;
      });

      return row;
    });
  }, [fitTarget, fitResult, fitProcessedData]);

  const analyses = useMemo(
    () =>
      processedDatasets.map((ds) => ({
        id: ds.id, name: ds.name,
        analysis: analyzeSteadyState(ds.processedData),
      })),
    [processedDatasets],
  );

  const toggleDataset = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleAutoDetect = () => {
    if (!fitProcessedData.length) return;
    const peaks = detectPeaks(fitProcessedData, 0.02);
    setDetectedPeaks(peaks);

    const initPeaks: PeakParams[] = peaks.slice(0, peakCount).map((dp) => ({
      id: makePeakId(),
      amplitude: dp.amplitude,
      center: dp.center,
      fwhm: Math.max(1, dp.fwhm),
      shape: peakShape,
      mu: 0.5,
    }));

    const xMin = fitProcessedData[0].x;
    const xMax = fitProcessedData[fitProcessedData.length - 1].x;
    while (initPeaks.length < peakCount) {
      const last = initPeaks[initPeaks.length - 1];
      const step = last ? Math.abs(xMax - xMin) / (peakCount + 1) : 10;
      initPeaks.push({
        id: makePeakId(),
        amplitude: last ? last.amplitude * 0.6 : 100,
        center: last ? last.center + step : xMin + (xMax - xMin) * 0.5,
        fwhm: last?.fwhm ?? 15,
        shape: peakShape,
        mu: 0.5,
      });
    }
    setManualPeaks(initPeaks.slice(0, peakCount));
  };

  const handleAddPeak = () => {
    if (!fitProcessedData.length) return;
    const xMin = fitProcessedData[0].x;
    const xMax = fitProcessedData[fitProcessedData.length - 1].x;
    const last = manualPeaks[manualPeaks.length - 1];
    setManualPeaks((prev) => [
      ...prev,
      {
        id: makePeakId(),
        amplitude: last ? last.amplitude * 0.6 : 100,
        center: last ? last.center + Math.abs(xMax - xMin) / (manualPeaks.length + 2) : xMin + (xMax - xMin) * 0.5,
        fwhm: last?.fwhm ?? 15,
        shape: peakShape,
        mu: 0.5,
      },
    ]);
  };

  const handleRemovePeak = (id: string) => {
    setManualPeaks((prev) => prev.filter((p) => p.id !== id));
  };

  const handleUpdatePeak = (id: string, field: keyof PeakParams, value: number) => {
    setManualPeaks((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  const handleFit = () => {
    if (!fitProcessedData.length || manualPeaks.length === 0) return;
    setFitLoading(true);
    setTimeout(() => {
      const result = fitPeaks(fitProcessedData, manualPeaks, 0);
      setFitResult(result);
      setFitLoading(false);
    }, 50);
  };

  const handleExportCSV = () => {
    if (!processedDatasets.length) return;
    exportMultiDatasetCSV(
      processedDatasets.map((ds) => ({ name: ds.name, data: ds.processedData })),
      'spectra_export.csv',
    );
  };

  const handleExportFitCSV = () => {
    if (!fitTarget || !fitResult) return;
    const dataWithFit = fitProcessedData.map((pt) => {
      const fitPt = fitResult.fittedCurve.find((f) => Math.abs(f.x - pt.x) < 1e-6);
      const res = fitResult.residuals.find((r) => Math.abs(r.x - pt.x) < 1e-6);
      return { x: pt.x, y_raw: pt.y, y_fitted: fitPt?.y ?? '', residual: res?.y ?? '' };
    });
    const header = 'x,y_raw,y_fitted,residual\n';
    const rows = dataWithFit.map((r) => `${r.x},${r.y_raw},${r.y_fitted},${r.residual}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fitTarget.name.replace(/\.[^.]+$/, '')}_fit.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = () => {
    exportChartPNG(chartRef.current, `FluoroLab_${Date.now()}.png`);
  };

  if (datasets.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 24px', color: '#64748B' }}>
        <Activity size={48} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
        <p style={{ fontSize: 16, marginBottom: 8 }}>尚未上传稳态荧光数据</p>
        <p style={{ fontSize: 13 }}>请先在「数据上传」页面上传文件</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>稳态荧光分析</h2>
          <p style={{ color: '#64748B', fontSize: 14 }}>
            光谱可视化 · 基线处理 · 峰值分析 · 分峰拟合 · 数据导出
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={handleExportCSV} style={btnStyle('#22C55E')}>
            <Download size={14} /> 导出数据
          </button>
          <button onClick={handleExportPNG} style={btnStyle('#A78BFA')}>
            <Image size={14} /> 导出图片
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 20 }}>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={cardStyle()}>
            <div style={sectionTitle()}>
              <BarChart2 size={14} /> 数据集
            </div>
            {datasets.map((ds, i) => {
              const color = COLORS[i % COLORS.length];
              const isActive = selectedIds.length === 0 || selectedIds.includes(ds.id);
              return (
                <button
                  key={ds.id}
                  onClick={() => toggleDataset(ds.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    textAlign: 'left', padding: '7px 8px', borderRadius: 6,
                    background: isActive ? `${color}15` : 'transparent',
                    border: `1px solid ${isActive ? `${color}40` : 'transparent'}`,
                    cursor: 'pointer', color: isActive ? color : '#64748B',
                    fontSize: 12, marginBottom: 4, transition: 'all 0.15s',
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: isActive ? color : '#334155', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.name}</span>
                </button>
              );
            })}
          </div>

          <div style={cardStyle()}>
            <div style={sectionTitle()}>
              <Sliders size={14} /> 数据处理
            </div>
            {[
              { key: 'subtractBg', label: '基线扣除' },
              { key: 'normalize', label: '归一化' },
              { key: 'smooth', label: '平滑滤波' },
              { key: 'logScale', label: '对数坐标轴' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={opts[key as keyof ProcessingOptions] as boolean}
                  onChange={(e) => setOpts((prev) => ({ ...prev, [key]: e.target.checked }))}
                  style={{ accentColor: '#38BDF8', width: 14, height: 14 }}
                />
                <span style={{ color: '#CBD5E1' }}>{label}</span>
              </label>
            ))}
            {opts.smooth && (
              <div>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>窗口: {opts.smoothWindow}</div>
                <input type="range" min={3} max={21} step={2} value={opts.smoothWindow}
                  onChange={(e) => setOpts((prev) => ({ ...prev, smoothWindow: +e.target.value }))}
                  style={{ width: '100%', accentColor: '#38BDF8' }} />
              </div>
            )}
          </div>

          {/* Peak Fitting */}
          <div style={cardStyle()}>
            <div style={sectionTitle()}>
              <Zap size={14} /> 分峰拟合
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>拟合目标</div>
              <select
                value={fitTarget?.id ?? ''}
                onChange={(e) => { setFitTargetId(e.target.value); setFitResult(null); }}
                style={selectStyle()}
              >
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>峰形函数</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {(['gaussian', 'lorentzian', 'voigt'] as PeakShape[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setPeakShape(s);
                      setManualPeaks((prev) => prev.map((p) => ({ ...p, shape: s })));
                    }}
                    style={{
                      flex: 1, padding: '5px 3px', borderRadius: 6, fontSize: 11,
                      background: peakShape === s ? '#38BDF820' : '#0F172A',
                      border: `1px solid ${peakShape === s ? '#38BDF8' : '#334155'}`,
                      color: peakShape === s ? '#38BDF8' : '#64748B', cursor: 'pointer',
                    }}
                  >
                    {SHAPE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>峰数量: {peakCount}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setPeakCount((c) => Math.max(1, c - 1))} style={miniBtn()}>−</button>
                <input type="range" min={1} max={6} value={peakCount}
                  onChange={(e) => setPeakCount(+e.target.value)} style={{ flex: 1, accentColor: '#38BDF8' }} />
                <button onClick={() => setPeakCount((c) => Math.min(6, c + 1))} style={miniBtn()}>+</button>
              </div>
            </div>

            <button onClick={handleAutoDetect} style={{ ...btnStyle('#38BDF8'), width: '100%', marginBottom: 8, fontSize: 12 }}>
              <Activity size={13} /> 自动寻峰
            </button>

            {detectedPeaks.length > 0 && (
              <div style={{ fontSize: 11, color: '#22C55E', marginBottom: 8 }}>
                检测到 {detectedPeaks.length} 个峰（点击调整）
              </div>
            )}

            {manualPeaks.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {manualPeaks.map((p, i) => (
                  <div key={p.id} style={{ background: '#0F172A', borderRadius: 8, padding: '8px 10px', marginBottom: 6, border: '1px solid #1E293B' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: COLORS[(i + 1) % COLORS.length], fontWeight: 600 }}>
                        峰 {i + 1}
                      </span>
                      <button onClick={() => handleRemovePeak(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {[
                      { label: '位置', field: 'center' as const, step: 0.5 },
                      { label: '幅度', field: 'amplitude' as const, step: 10 },
                      { label: 'FWHM', field: 'fwhm' as const, step: 0.5 },
                    ].map(({ label, field, step }) => (
                      <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: '#64748B', width: 30, flexShrink: 0 }}>{label}</span>
                        <input
                          type="number" value={p[field]} step={step}
                          onChange={(e) => handleUpdatePeak(p.id, field, +e.target.value)}
                          style={numInputStyle()}
                        />
                      </div>
                    ))}
                  </div>
                ))}
                <button onClick={handleAddPeak} style={{ ...btnStyle('#64748B'), width: '100%', fontSize: 11, padding: '4px 8px', justifyContent: 'center' }}>
                  <Plus size={12} /> 添加峰
                </button>
              </div>
            )}

            <button
              onClick={handleFit}
              disabled={fitLoading || manualPeaks.length === 0}
              style={{
                ...btnStyle('#22C55E'), width: '100%', fontSize: 13,
                opacity: fitLoading || manualPeaks.length === 0 ? 0.5 : 1,
                cursor: fitLoading || manualPeaks.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {fitLoading ? '拟合中…' : <><Play size={13} /> 开始拟合</>}
            </button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div ref={chartRef} style={{ background: '#1E293B', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
            <ResponsiveContainer width="100%" height={fitResult ? 320 : 380}>
              <LineChart data={fitResult ? fitChartData : chartData} margin={{ top: 5, right: 20, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  dataKey="x"
                  tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                  label={{ value: fitTarget?.xLabel || 'Wavelength (nm)', position: 'insideBottom', offset: -15, fill: '#64748B', fontSize: 12 }}
                  stroke="#334155"
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                  label={{ value: opts.logScale ? 'log(Intensity)' : (opts.normalize ? 'Normalized' : 'Intensity'), angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 12 }}
                  stroke="#334155"
                />
                <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8, fontSize: 12, fontFamily: 'Roboto Mono' }} />
                <Legend formatter={(value) => {
                  const ds = datasets.find((d) => d.id === value);
                  return <span style={{ fontSize: 12, color: '#CBD5E1' }}>{ds?.name || value}</span>;
                }} />

                {fitResult ? (
                  <>
                    <Line dataKey={fitTarget!.id + '_raw'} name="原始数据" stroke="#64748B" dot={false} strokeWidth={1.5} opacity={0.5} isAnimationActive={false} />
                    <Line dataKey={fitTarget!.id + '_fit'} name="拟合曲线" stroke="#38BDF8" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                    {fitResult.peaks.map((_, i) => (
                      <Line
                        key={i} dataKey={`peak_${i}`} name={`峰 ${i + 1}`}
                        stroke={COLORS[(i + 1) % COLORS.length]} dot={false}
                        strokeWidth={1.5} strokeDasharray="4 2" isAnimationActive={false}
                      />
                    ))}
                  </>
                ) : (
                  processedDatasets.map((ds, i) => (
                    <Line key={ds.id} dataKey={ds.id} name={ds.name}
                      stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2}
                      connectNulls isAnimationActive={false}
                    />
                  ))
                )}
              </LineChart>
            </ResponsiveContainer>

            {fitResult && showResiduals && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>残差分布</div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={fitResult.residuals.map((p) => ({ x: p.x, y: Number(p.y.toFixed(5)) }))} margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="x" tick={{ fill: '#94A3B8', fontSize: 10 }} stroke="#334155" />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} stroke="#334155" width={50} />
                    <Line dataKey="y" stroke="#EF4444" dot={false} strokeWidth={1} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Fit Results */}
          {fitResult && (
            <div style={cardStyle()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={15} color="#38BDF8" /> 分峰拟合结果
                </h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowResiduals((v) => !v)} style={{ ...btnStyle('#A78BFA'), fontSize: 11, padding: '5px 10px' }}>
                    {showResiduals ? '隐藏' : '显示'}残差
                  </button>
                  <button onClick={handleExportFitCSV} style={{ ...btnStyle('#22C55E'), fontSize: 11, padding: '5px 10px' }}>
                    <Download size={12} /> 拟合数据
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'R²', value: fitResult.rSquared.toFixed(6) },
                  { label: 'χ² red', value: fitResult.reducedChiSq.toExponential(3) },
                  { label: '总峰面积', value: fitResult.totalArea.toExponential(3) },
                  { label: '基线', value: fitResult.baseline.toFixed(4) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 14, fontFamily: 'Roboto Mono', color: '#38BDF8', fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'Roboto Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['峰', '峰形', '位置', '幅度', 'FWHM', '面积', '占比'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#64748B', fontWeight: 500, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fitResult.peaks.map((p, i) => {
                      const area = p.shape === 'gaussian' ? gaussianArea(p.amplitude, p.fwhm)
                        : p.shape === 'lorentzian' ? lorentzianArea(p.amplitude, p.fwhm)
                        : pseudoVoigtArea(p.amplitude, p.fwhm, p.mu);
                      const frac = fitResult.totalArea > 0 ? (area / fitResult.totalArea * 100).toFixed(1) : '—';
                      return (
                        <tr key={p.id} style={{ borderBottom: '1px solid #0F172A' }}>
                          <td style={{ padding: '9px 10px', color: COLORS[(i + 1) % COLORS.length], fontWeight: 600 }}>{i + 1}</td>
                          <td style={{ padding: '9px 10px', color: '#94A3B8', fontSize: 11 }}>{SHAPE_LABELS[p.shape]}</td>
                          <td style={{ padding: '9px 10px', color: '#F8FAFC' }}>{p.center.toFixed(2)}</td>
                          <td style={{ padding: '9px 10px', color: '#F8FAFC' }}>{p.amplitude.toExponential(3)}</td>
                          <td style={{ padding: '9px 10px', color: '#F8FAFC' }}>{p.fwhm.toFixed(2)}</td>
                          <td style={{ padding: '9px 10px', color: '#F8FAFC' }}>{area.toExponential(3)}</td>
                          <td style={{ padding: '9px 10px', color: '#22C55E' }}>{frac}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Analysis table */}
          {analyses.length > 0 && (
            <div style={cardStyle()}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={15} color="#38BDF8" /> 光谱参数分析
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'Roboto Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['数据集', '峰值波长', '峰值强度', 'FWHM', '质心', '积分强度'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analyses.map(({ id, name, analysis }, i) => (
                      <tr key={id} style={{ borderBottom: '1px solid #0F172A' }}>
                        <td style={{ padding: '10px 12px', color: COLORS[i % COLORS.length], maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</td>
                        <td style={{ padding: '10px 12px', color: '#F8FAFC' }}>{analysis.peakWavelength.toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', color: '#F8FAFC' }}>{analysis.peakIntensity.toExponential(3)}</td>
                        <td style={{ padding: '10px 12px', color: '#F8FAFC' }}>{analysis.fwhm.toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', color: '#F8FAFC' }}>{analysis.centroid.toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', color: '#F8FAFC' }}>{analysis.integratedIntensity.toExponential(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cardStyle() { return { background: '#1E293B', borderRadius: 12, padding: 16, border: '1px solid #334155' }; }
function sectionTitle() { return { fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }; }
function btnStyle(color: string) {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, background: `${color}15`, border: `1px solid ${color}40`, color, fontSize: 13, cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s' };
}
function miniBtn() {
  return { width: 28, height: 28, borderRadius: 6, background: '#0F172A', border: '1px solid #334155', color: '#94A3B8', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
}
function selectStyle() {
  return { width: '100%', padding: '6px 8px', borderRadius: 6, background: '#0F172A', border: '1px solid #334155', color: '#CBD5E1', fontSize: 12, outline: 'none' };
}
function numInputStyle() {
  return { flex: 1, padding: '3px 6px', borderRadius: 4, background: '#0F172A', border: '1px solid #334155', color: '#F8FAFC', fontSize: 11, fontFamily: 'Roboto Mono', outline: 'none', minWidth: 0 };
}
