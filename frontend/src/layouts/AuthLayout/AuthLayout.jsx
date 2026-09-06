/**
 * SmartNav360 — AuthLayout
 * Centered layout for login and authentication pages.
 */

import { Outlet } from 'react-router-dom';
import './AuthLayout.css';

export default function AuthLayout() {
  return (
    <div className="auth-layout">
      <div className="auth-layout__container">
        <Outlet />
      </div>
      <footer className="auth-layout__footer">
        <span>SmartNav360 · AI-Assisted Configurable 360° Virtual Navigation Framework</span>
      </footer>
    </div>
  );
}
