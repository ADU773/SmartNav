/**
 * SmartNav360 — MainLayout
 * Primary workspace layout containing Sidebar, TopNavbar, content area, and footer.
 * Used by all workspace pages.
 */

import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Drawer } from 'antd';
import Sidebar from '../../components/layout/Sidebar';
import TopNavbar from '../../components/layout/TopNavbar';
import Logo from '../../components/common/Logo';
import './MainLayout.css';

const COLLAPSE_STORAGE_KEY = 'smartnav360_sidebar_collapsed';

export default function MainLayout() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleCollapse = (value) => {
    setSidebarCollapsed(value);
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(value));
    } catch {
      // Storage may be unavailable (private browsing); collapse state just won't persist.
    }
  };

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`main-layout ${sidebarCollapsed ? 'main-layout--collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} onCollapse={handleCollapse} />

      <Drawer
        placement="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        closable={false}
        width={272}
        className="main-layout__mobile-drawer"
        title={<Logo size={32} subtitle="Navigation Platform" />}
      >
        <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>

      <div className="main-layout__content-wrapper">
        <TopNavbar onMenuClick={() => setMobileNavOpen(true)} />

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
