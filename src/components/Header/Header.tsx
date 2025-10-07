import React from 'react';
import { NavLink } from 'react-router-dom';
import './Header.css';

export const Header: React.FC = () => {
  return (
    <header className="woke-palantir-nav">
      <div className="brand-section">
        <div className="live-indicator"></div>
        <span>WOKE PALANTIR</span>
      </div>
      
      <div className="nav-tabs">
        <NavLink
          to="/map"
          className={({ isActive }) =>
            `nav-tab ${isActive ? 'active' : ''}`
          }
        >
          Map View
        </NavLink>
        <NavLink
          to="/directory"
          className={({ isActive }) =>
            `nav-tab ${isActive ? 'active' : ''}`
          }
        >
          List View
        </NavLink>
        <NavLink
          to="/actors"
          className={({ isActive }) =>
            `nav-tab ${isActive ? 'active' : ''}`
          }
        >
          Actors
        </NavLink>
        <NavLink
          to="/actor-classifier"
          className={({ isActive }) =>
            `nav-tab ${isActive ? 'active' : ''}`
          }
        >
          Actor Classifier
        </NavLink>
        <NavLink
          to="/chat"
          className={({ isActive }) =>
            `nav-tab ${isActive ? 'active' : ''}`
          }
        >
          AI Assistant
        </NavLink>
      </div>
      
      <div className="nav-actions">
        {/* Placeholder for future actions */}
        <span className="text-sm text-gray-500">Real-time Event Monitoring</span>
      </div>
    </header>
  );
};
