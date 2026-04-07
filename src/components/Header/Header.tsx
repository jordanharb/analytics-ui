import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import './Header.css';

export const Header: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? '';
  const displayName = email.split('@')[0] || 'user';
  const initials = displayName
    .split(/[._-]/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <header className="woke-palantir-nav">
      <div className="brand-section">
        <span>fieldnotes<span style={{ color: '#c2410c' }}>_</span></span>
      </div>

      <div className="nav-tabs">
        <NavLink to="/map" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          map
        </NavLink>
        <NavLink to="/directory" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          list
        </NavLink>
        <NavLink to="/actors" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          directory
        </NavLink>
      </div>

      <div className="nav-actions" ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <span style={{ fontSize: 13, color: '#6b6b6b' }}>{displayName}</span>
          <span style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#c2410c', color: '#fdfaf2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 500,
          }}>
            {initials}
          </span>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8,
            background: '#fdfaf2', border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            minWidth: 160, zIndex: 50, overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => { setDropdownOpen(false); navigate('/settings'); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 16px', fontSize: 13, color: '#1a1a1a',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#ede5d2'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              settings
            </button>
            <div style={{ height: 1, background: 'rgba(0,0,0,0.08)' }} />
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 16px', fontSize: 13, color: '#c2410c',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#ede5d2'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
