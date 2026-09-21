/**
 * SmartNav360 — Sidebar
 * Collapsible sidebar navigation with grouped menu items.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { Menu } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { SIDEBAR_GROUPS } from '../../../constants/sidebar';
import { useProject } from '../../../contexts/ProjectContext';
import Logo from '../../common/Logo';
import './Sidebar.css';

export default function Sidebar({ collapsed = false, onCollapse, mobile = false, onNavigate }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProject } = useProject();

  const activeKey = location.pathname.split('/')[1] || 'dashboard';
  const isCollapsed = mobile ? false : collapsed;

  const goTo = (path) => {
    navigate(path);
    onNavigate?.();
  };

  const menuItems = SIDEBAR_GROUPS.map((group) => ({
    key: group.key,
    type: 'group',
    label: isCollapsed ? null : group.label,
    children: group.items.map((item) => ({
      key: item.key,
      icon: <item.icon />,
      label: item.label,
      onClick: () => goTo(item.path),
    })),
  }));

  return (
    <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''} ${mobile ? 'sidebar--mobile' : ''}`}>
      {/* Brand */}
      {!mobile && (
        <div className="sidebar__brand" onClick={() => goTo('/')}>
          <Logo size={36} showText={!isCollapsed} subtitle="Navigation Platform" />
        </div>
      )}

      {/* Project Indicator */}
      {currentProject && !isCollapsed && (
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
          inlineCollapsed={isCollapsed}
        />
      </div>

      {/* Collapse Toggle */}
      {!mobile && (
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
      )}
    </aside>
  );
}
