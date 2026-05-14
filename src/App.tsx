import { useState } from 'react';
import type { FluorescenceDataset, IRFDataset } from './types/fluorescence';
import Navbar from './components/Navbar';
import UploadPanel from './components/UploadPanel';
import SteadyStatePanel from './components/SteadyStatePanel';
import TransientPanel from './components/TransientPanel';
import './index.css';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('upload');
  const [steadyStateDatasets, setSteadyStateDatasets] = useState<FluorescenceDataset[]>([]);
  const [transientDatasets, setTransientDatasets] = useState<FluorescenceDataset[]>([]);
  const [irfDatasets, setIRFDatasets] = useState<IRFDataset[]>([]);

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A' }}>
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />

      <main style={{ minHeight: 'calc(100vh - 57px)' }}>
        {activeTab === 'upload' && (
          <UploadPanel
            steadyStateDatasets={steadyStateDatasets}
            transientDatasets={transientDatasets}
            irfDatasets={irfDatasets}
            onSteadyAdd={(ds) => setSteadyStateDatasets((p) => [...p, ds])}
            onTransientAdd={(ds) => setTransientDatasets((p) => [...p, ds])}
            onIRFAdd={(ds) => setIRFDatasets((p) => [...p, ds])}
            onSteadyRemove={(id) => setSteadyStateDatasets((p) => p.filter((d) => d.id !== id))}
            onTransientRemove={(id) => setTransientDatasets((p) => p.filter((d) => d.id !== id))}
            onIRFRemove={(id) => setIRFDatasets((p) => p.filter((d) => d.id !== id))}
          />
        )}
        {activeTab === 'steady-state' && (
          <SteadyStatePanel datasets={steadyStateDatasets} />
        )}
        {activeTab === 'transient' && (
          <TransientPanel datasets={transientDatasets} irfDatasets={irfDatasets} />
        )}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '16px', fontSize: 12, color: '#94A3B8',
        borderTop: '1px solid #E2E8F0',
        fontFamily: 'Roboto Mono, monospace',
      }}>
        FluoroLab — Fluorescence Data Analysis Platform
      </footer>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
