/**
 * SmartNav360 — Sidebar
 * Collapsible sidebar navigation with grouped menu items.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, Tooltip } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { SIDEBAR_GROUPS } from '../../../constants/sidebar';
import { useProject } from '../../../contexts/ProjectContext';
import './Sidebar.css';

export default function Sidebar({ collapsed, onCollapse }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProject } = useProject();

  const activeKey = location.pathname.split('/')[1] || 'dashboard';

  const menuItems = SIDEBAR_GROUPS.map((group) => ({
    key: group.key,
    type: 'group',
    label: collapsed ? null : group.label,
    children: group.items.map((item) => ({
      key: item.key,
      icon: <item.icon />,
      label: item.label,
      onClick: () => navigate(item.path),
    })),
  }));

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Brand */}
      <div className="sidebar__brand" onClick={() => navigate('/')}>
        <div className="sidebar__logo">
          <span className="sidebar__logo-icon">◇</span>
        </div>
        {!collapsed && (
          <div className="sidebar__brand-text">
            <span className="sidebar__brand-name">SmartNav360</span>
            <span className="sidebar__brand-sub">Navigation Platform</span>
          </div>
        )}
      </div>

      {/* Project Indicator */}
      {currentProject && !collapsed && (
        <div className="sidebar__project">
          <div className="sidebar__project-avatar">
            {currentProject.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="sidebar__project-info">
            <span className="sidebar__project-name">{currentProject.name}</span>
            <span className="sidebar__project-label">Current Project</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="sidebar__nav">
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          inlineCollapsed={collapsed}
        />
      </div>

      {/* Collapse Toggle */}
      <div className="sidebar__footer">
        <button
          className="sidebar__toggle"
          onClick={() => onCollapse(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
