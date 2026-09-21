/**
 * SmartNav360 — Logo
 * Shared brand mark used across the sidebar, login, and project selection screens.
 */

import { CompassOutlined } from '@ant-design/icons';
import './Logo.css';

export default function Logo({ size = 36, showText = true, subtitle, onClick, className = '' }) {
  return (
    <div
      className={`logo ${onClick ? 'logo--clickable' : ''} ${className}`}
      style={{ '--logo-size': `${size}px` }}
      onClick={onClick}
    >
      <span className="logo__mark">
        <CompassOutlined />
      </span>
      {showText && (
        <span className="logo__text">
          <span className="logo__name">SmartNav360</span>
          {subtitle && <span className="logo__subtitle">{subtitle}</span>}
        </span>
      )}
    </div>
  );
}
