/**
 * SmartNav360 — MainLayout
 * Primary workspace layout containing Sidebar, TopNavbar, content area, and footer.
 * Used by all workspace pages.
 */

import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import TopNavbar from '../../components/layout/TopNavbar';
import './MainLayout.css';

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`main-layout ${sidebarCollapsed ? 'main-layout--collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} />

      <div className="main-layout__content-wrapper">
        <TopNavbar />

        <main className="main-layout__content">
          <Outlet />
        </main>

        <footer className="main-layout__footer">
          <span className="main-layout__footer-text">
            SmartNav360 · AI-Assisted Configurable 360° Virtual Navigation Framework
          </span>
          <span className="main-layout__footer-version">v0.1.0</span>
        </footer>
      </div>
    </div>
  );
}
