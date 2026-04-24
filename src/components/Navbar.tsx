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
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid #1E293B',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 0 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', marginRight: 40 }}>
          <div
            style={{
              width: 32, height: 32,
              background: 'linear-gradient(135deg, #38BDF8, #A78BFA)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <FlaskConical size={18} color="white" />
          </div>
          <span style={{ fontFamily: 'Exo, sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: '-0.5px' }}>
            Fluoro<span style={{ color: '#38BDF8' }}>Lab</span>
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
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 18px',
                  background: isActive ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  border: 'none',
                  borderBottom: isActive ? '2px solid #38BDF8' : '2px solid transparent',
                  color: isActive ? '#38BDF8' : '#94A3B8',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontFamily: 'Exo, sans-serif',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.color = '#CBD5E1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8';
                  }
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
          <BarChart3 size={14} color="#64748B" />
          <span style={{ fontSize: 12, color: '#64748B', fontFamily: 'Roboto Mono, monospace' }}>
            Fluorescence Data Analysis
          </span>
        </div>
      </div>
    </nav>
  );
}
