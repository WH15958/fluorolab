import { Upload, Activity, Zap, FlaskConical, BarChart3 } from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'upload', label: '数据上传', icon: Upload },
  { id: 'steady-state', label: '稳态分析', icon: Activity },
  { id: 'transient', label: '瞬态分析', icon: Zap },
];

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  return (
    <nav
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        borderBottom: '1px solid #E2E8F0',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <style>{`.nav-tab:hover:not(.nav-tab-active) { color: #334155 !important; }`}</style>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 0 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', marginRight: 40 }}>
          <div
            style={{
              width: 32, height: 32,
              background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <FlaskConical size={18} color="white" />
          </div>
          <span style={{ fontFamily: 'Exo, sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: '-0.5px' }}>
            Fluoro<span style={{ color: '#2563EB' }}>Lab</span>
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                  className={`nav-tab${isActive ? ' nav-tab-active' : ''}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 18px',
                    background: isActive ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #2563EB' : '2px solid transparent',
                    color: isActive ? '#2563EB' : '#64748B',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontFamily: 'Exo, sans-serif',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                  }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Right side badge */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart3 size={14} color="#94A3B8" />
          <span style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'Roboto Mono, monospace' }}>
            Fluorescence Data Analysis
          </span>
        </div>
      </div>
    </nav>
  );
}
