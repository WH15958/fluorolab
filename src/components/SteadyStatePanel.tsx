import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { Activity, TrendingUp, BarChart2, Sliders } from 'lucide-react';
import type { FluorescenceDataset } from '../types/fluorescence';
import { analyzeSteadyState, normalizeData, subtractBaseline, smoothData } from '../utils/steadyStateAnalysis';

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

export default function SteadyStatePanel({ datasets }: SteadyStatePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [opts, setOpts] = useState<ProcessingOptions>({
    normalize: false, subtractBg: false, smooth: false, smoothWindow: 5, logScale: false,
  });

  const activeDatasets = datasets.filter(
    (ds) => selectedIds.length === 0 || selectedIds.includes(ds.id)
  );

  // Process data
  const processedDatasets = useMemo(() =>
    activeDatasets.map((ds) => {
      let data = [...ds.rawData];
      if (opts.subtractBg) data = subtractBaseline(data);
      if (opts.smooth) data = smoothData(data, opts.smoothWindow);
      if (opts.normalize) data = normalizeData(data);
      return { ...ds, processedData: data };
    }),
  [activeDatasets, opts]);

  // Merge for chart
  const chartData = useMemo(() => {
    if (processedDatasets.length === 0) return [];
    
    const allX = new Set<number>();
    processedDatasets.forEach((ds) => ds.processedData.forEach((p) => allX.add(p.x)));
    const sortedX = Array.from(allX).sort((a, b) => a - b);
    
    return sortedX.map((x) => {
      const row: Record<string, number> = { x };
      processedDatasets.forEach((ds) => {
        const pt = ds.processedData.find((p) => p.x === x);
        if (pt) row[ds.id] = opts.logScale && pt.y > 0 ? Math.log10(pt.y) : pt.y;
      });
      return row;
    });
  }, [processedDatasets, opts.logScale]);

  const analyses = useMemo(() =>
    processedDatasets.map((ds) => ({
      id: ds.id,
      name: ds.name,
      analysis: analyzeSteadyState(ds.processedData),
    })),
  [processedDatasets]);

  const toggleDataset = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>稳态荧光分析</h2>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>
        发射/激发光谱可视化与峰值、FWHM、质心等参数分析
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Dataset selector */}
          <div style={{ background: '#1E293B', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', textAlign: 'left',
                    padding: '7px 8px', borderRadius: 6,
                    background: isActive ? `${color}15` : 'transparent',
                    border: `1px solid ${isActive ? `${color}40` : 'transparent'}`,
                    cursor: 'pointer',
                    color: isActive ? color : '#64748B',
                    fontSize: 12,
                    transition: 'all 0.15s ease',
                    marginBottom: 4,
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: isActive ? color : '#334155', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.name}</span>
                </button>
              );
            })}
          </div>

          {/* Processing options */}
          <div style={{ background: '#1E293B', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}>
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
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>窗口大小: {opts.smoothWindow}</div>
                <input
                  type="range" min={3} max={21} step={2}
                  value={opts.smoothWindow}
                  onChange={(e) => setOpts((prev) => ({ ...prev, smoothWindow: +e.target.value }))}
                  style={{ width: '100%', accentColor: '#38BDF8' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Chart + Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Chart */}
          <div style={{ background: '#1E293B', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  dataKey="x"
                  tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                  label={{ value: activeDatasets[0]?.xLabel || 'X', position: 'insideBottom', offset: -15, fill: '#64748B', fontSize: 12 }}
                  stroke="#334155"
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 12, fontFamily: 'Roboto Mono' }}
                  label={{
                    value: opts.logScale ? 'log₁₀(Intensity)' : (opts.normalize ? 'Normalized Intensity' : 'Intensity'),
                    angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 12,
                  }}
                  stroke="#334155"
                />
                <Tooltip
                  contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: 8, fontSize: 12, fontFamily: 'Roboto Mono' }}
                  labelFormatter={(v) => `X: ${Number(v).toFixed(2)}`}
                />
                <Legend
                  formatter={(value) => {
                    const ds = datasets.find((d) => d.id === value);
                    return <span style={{ fontSize: 12, color: '#CBD5E1' }}>{ds?.name || value}</span>;
                  }}
                />
                {processedDatasets.map((ds, i) => (
                  <Line
                    key={ds.id}
                    dataKey={ds.id}
                    name={ds.id}
                    stroke={COLORS[i % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Analysis Table */}
          {analyses.length > 0 && (
            <div style={{ background: '#1E293B', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={15} color="#38BDF8" /> 光谱参数分析
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Roboto Mono, monospace' }}>
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
                        <td style={{ padding: '10px 12px', color: COLORS[i % COLORS.length], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                          {name}
                        </td>
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
