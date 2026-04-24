import React, { useCallback, useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { FluorescenceDataset, IRFDataset } from '../types/fluorescence';
import { readDatasetFromFile, readIRFFromFile } from '../utils/fileParser';

interface UploadPanelProps {
  steadyStateDatasets: FluorescenceDataset[];
  transientDatasets: FluorescenceDataset[];
  irfDatasets: IRFDataset[];
  onSteadyAdd: (ds: FluorescenceDataset) => void;
  onTransientAdd: (ds: FluorescenceDataset) => void;
  onIRFAdd: (ds: IRFDataset) => void;
  onSteadyRemove: (id: string) => void;
  onTransientRemove: (id: string) => void;
  onIRFRemove: (id: string) => void;
}

interface UploadZoneProps {
  label: string;
  sublabel: string;
  color: string;
  onFiles: (files: File[]) => void;
  loading?: boolean;
}

function UploadZone({ label, sublabel, color, onFiles, loading }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.txt') || f.name.endsWith('.csv')
    );
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onFiles(files);
    e.target.value = '';
  };

  return (
    <label
      style={{
        display: 'block',
        border: `2px dashed ${isDragging ? color : '#334155'}`,
        borderRadius: 12,
        padding: '28px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragging ? `${color}0a` : 'rgba(30, 41, 59, 0.4)',
        transition: 'all 0.2s ease',
        position: 'relative',
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLLabelElement).style.borderColor = color;
        (e.currentTarget as HTMLLabelElement).style.background = `${color}08`;
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          (e.currentTarget as HTMLLabelElement).style.borderColor = '#334155';
          (e.currentTarget as HTMLLabelElement).style.background = 'rgba(30, 41, 59, 0.4)';
        }
      }}
    >
      <input
        type="file"
        accept=".txt,.csv"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      {loading ? (
        <Loader2 size={28} color={color} style={{ margin: '0 auto 12px', display: 'block', animation: 'spin 1s linear infinite' }} />
      ) : (
        <Upload size={28} color={color} style={{ margin: '0 auto 12px', display: 'block' }} />
      )}
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#64748B' }}>{sublabel}</div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>支持 .txt / .csv 格式，可拖拽上传</div>
    </label>
  );
}

function DatasetTag({
  name, color, onRemove
}: { name: string; color: string; onRemove: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: `${color}12`,
      border: `1px solid ${color}30`,
      borderRadius: 8,
      padding: '6px 10px',
      fontSize: 13,
    }}>
      <CheckCircle size={14} color={color} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
        {name}
      </span>
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#64748B' }}
        title="移除"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function UploadPanel({
  steadyStateDatasets, transientDatasets, irfDatasets,
  onSteadyAdd, onTransientAdd, onIRFAdd,
  onSteadyRemove, onTransientRemove, onIRFRemove,
}: UploadPanelProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const [loadingType, setLoadingType] = useState<string | null>(null);

  const handleFiles = async (files: File[], type: 'steady-state' | 'transient' | 'irf') => {
    setErrors([]);
    setLoadingType(type);
    const errs: string[] = [];

    for (const file of files) {
      try {
        if (type === 'irf') {
          const ds = await readIRFFromFile(file);
          onIRFAdd(ds);
        } else {
          const ds = await readDatasetFromFile(file, type);
          if (type === 'steady-state') onSteadyAdd(ds);
          else onTransientAdd(ds);
        }
      } catch (e: any) {
        errs.push(`${file.name}: ${e.message}`);
      }
    }

    setErrors(errs);
    setLoadingType(null);
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>数据上传</h2>
      <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
        上传荧光数据文件（.txt 或 .csv），每列分别为 X（波长/时间）和 Y（强度）。
        支持逗号、制表符、空格分隔，自动识别文件头。
      </p>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 24,
        }}>
          {errors.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#EF4444', fontSize: 13 }}>
              <AlertCircle size={14} />
              {e}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
        {/* Steady State */}
        <div>
          <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14, color: '#38BDF8' }}>
            稳态荧光数据
          </div>
          <UploadZone
            label="上传稳态数据"
            sublabel="发射/激发光谱"
            color="#38BDF8"
            onFiles={(files) => handleFiles(files, 'steady-state')}
            loading={loadingType === 'steady-state'}
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steadyStateDatasets.map((ds) => (
              <DatasetTag key={ds.id} name={ds.name} color="#38BDF8" onRemove={() => onSteadyRemove(ds.id)} />
            ))}
          </div>
        </div>

        {/* Transient */}
        <div>
          <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14, color: '#A78BFA' }}>
            瞬态荧光数据 (TCSPC/TRPL)
          </div>
          <UploadZone
            label="上传瞬态衰减数据"
            sublabel="时间分辨荧光"
            color="#A78BFA"
            onFiles={(files) => handleFiles(files, 'transient')}
            loading={loadingType === 'transient'}
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {transientDatasets.map((ds) => (
              <DatasetTag key={ds.id} name={ds.name} color="#A78BFA" onRemove={() => onTransientRemove(ds.id)} />
            ))}
          </div>
        </div>

        {/* IRF */}
        <div>
          <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14, color: '#F59E0B' }}>
            仪器响应函数 (IRF)
          </div>
          <UploadZone
            label="上传 IRF 数据"
            sublabel="用于卷积去卷积拟合"
            color="#F59E0B"
            onFiles={(files) => handleFiles(files, 'irf')}
            loading={loadingType === 'irf'}
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {irfDatasets.map((ds) => (
              <DatasetTag key={ds.id} name={ds.name} color="#F59E0B" onRemove={() => onIRFRemove(ds.id)} />
            ))}
          </div>
        </div>
      </div>

      {/* Format Guide */}
      <div style={{
        marginTop: 40,
        background: 'rgba(30, 41, 59, 0.5)',
        borderRadius: 12,
        padding: '20px 24px',
        border: '1px solid #1E293B',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#94A3B8' }}>文件格式说明</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[
            { title: 'CSV 格式', code: '波长(nm),强度\n300,1250.3\n301,2341.7\n302,3892.1' },
            { title: 'TXT 格式（制表符）', code: '# 荧光光谱数据\nTime\tCounts\n0.0\t15234\n0.1\t12890\n0.2\t10234' },
            { title: 'TXT 格式（空格）', code: '# 无标题行\n300 1250.3\n301 2341.7\n302 3892.1' },
          ].map(({ title, code }) => (
            <div key={title}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>{title}</div>
              <pre style={{
                fontFamily: 'Roboto Mono, monospace',
                fontSize: 11,
                background: 'rgba(15, 23, 42, 0.8)',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#CBD5E1',
                margin: 0,
                overflow: 'auto',
              }}>{code}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
