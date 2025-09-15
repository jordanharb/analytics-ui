import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './LaunchPage.css';

export const LaunchPage: React.FC = () => {
  const navigate = useNavigate();

  const launchApp = (appName: string) => {
    if (appName === 'woke-palantir') {
      navigate('/map');
    } else if (appName === 'legislature') {
      navigate('/legislature');
    }
  };

  useEffect(() => {
    // Create dynamic tumbleweeds periodically
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const tumbleweed = document.createElement('div');
        tumbleweed.className = 'tumbleweed';
        tumbleweed.style.animationDuration = `${15 + Math.random() * 10}s`;
        tumbleweed.style.width = tumbleweed.style.height = `${25 + Math.random() * 20}px`;
        tumbleweed.style.bottom = `${10 + Math.random() * 30}px`;
        document.body.appendChild(tumbleweed);
        
        // Remove after animation completes
        setTimeout(() => tumbleweed.remove(), 25000);
      }
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="launch-page-wrapper">
      {/* Desert Sun */}
      <div className="sun"></div>

      {/* Desert Mountains */}
      <div className="mountains"></div>

      {/* Flying Birds */}
      <div className="bird bird-1">🦅</div>
      <div className="bird bird-2">🦅</div>

      {/* Tumbleweeds */}
      <div className="tumbleweed" style={{ animationDelay: '0s' }}></div>
      <div className="tumbleweed" style={{ animationDelay: '7s', width: '30px', height: '30px' }}></div>
      <div className="tumbleweed" style={{ animationDelay: '14s', width: '35px', height: '35px' }}></div>

      {/* Main Container */}
      <div className="container">
        {/* Logo Section */}
        <div className="logo-section">
          <div className="logo-text">
            <div className="logo-main">RESILIENT</div>
            <div className="logo-sub">STRATEGIES</div>
          </div>
        </div>

        {/* App Grid */}
        <div className="app-grid">
          {/* Woke Palantir Widget */}
          <div className="app-widget" onClick={() => launchApp('woke-palantir')}>
            <div className="app-header">
              <div className="live-indicator"></div>
              <span className="app-title">WOKE PALANTIR</span>
            </div>
            <div className="app-description">
              Real-time event monitoring and intelligence gathering system. Track, analyze, and visualize social movements and political activities across multiple data sources.
            </div>
            <div className="app-status">
              <span className="status-badge">ACTIVE</span>
              <button 
                className="desert-btn" 
                onClick={(e) => {
                  e.stopPropagation();
                  launchApp('woke-palantir');
                }}
              >
                Launch App →
              </button>
            </div>
          </div>

          {/* Legislature & Campaign Finance Widget */}
          <div className="app-widget" onClick={() => launchApp('legislature')} style={{ animationDelay: '0.2s' }}>
            <div className="app-header">
              <div className="live-indicator"></div>
              <span className="app-title">LEGISLATURE & CAMPAIGN</span>
            </div>
            <div className="app-description">
              Comprehensive tracking of legislative activities and campaign finance data. Monitor bill progress, voting records, and financial contributions across Arizona politics.
            </div>
            <div className="app-status">
              <span className="status-badge">ACTIVE</span>
              <button 
                className="desert-btn" 
                onClick={(e) => {
                  e.stopPropagation();
                  launchApp('legislature');
                }}
              >
                Launch App →
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <p>© 2025 Resilient Strategies • <a href="https://resilientstrategiesaz.com">ResilientStrategiesAZ.com</a></p>
        </div>
      </div>
    </div>
  );
};