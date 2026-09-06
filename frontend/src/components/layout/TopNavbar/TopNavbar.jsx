/**
 * SmartNav360 — TopNavbar
 * Top navigation bar with breadcrumb, project switcher, search, theme toggle, and user profile.
 */

import { useNavigate } from 'react-router-dom';
import { Breadcrumb, Input, Button, Dropdown, Avatar, Tooltip, Badge } from 'antd';
import {
  SearchOutlined,
  BellOutlined,
  SunOutlined,
  MoonOutlined,
  UserOutlined,
  SwapOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useProject } from '../../../contexts/ProjectContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import './TopNavbar.css';

export default function TopNavbar({ breadcrumbItems = [] }) {
  const navigate = useNavigate();
  const { currentProject, clearProject } = useProject();
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  const handleSwitchProject = () => {
    clearProject();
    navigate('/');
  };

  const userMenuItems = {
    items: [
      {
        key: 'profile',
        icon: <UserOutlined />,
        label: 'Profile',
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: 'Settings',
        onClick: () => navigate('/settings'),
      },
      { type: 'divider' },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: 'Log out',
        danger: true,
        onClick: logout,
      },
    ],
  };

  return (
    <header className="topnavbar">
      <div className="topnavbar__left">
        <Breadcrumb
          items={[
            { title: currentProject?.name || 'SmartNav360' },
            ...breadcrumbItems.map((item) => ({ title: item })),
          ]}
        />
      </div>

      <div className="topnavbar__right">
        {/* Project Switcher */}
        {currentProject && (
          <Tooltip title="Switch Project">
            <Button
              type="text"
              icon={<SwapOutlined />}
              onClick={handleSwitchProject}
              className="topnavbar__action"
            />
          </Tooltip>
        )}

        {/* Global Search */}
        <div className="topnavbar__search">
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search..."
            size="small"
            className="topnavbar__search-input"
          />
        </div>

        {/* Notifications */}
        <Tooltip title="Notifications">
          <Badge count={0} size="small">
            <Button
              type="text"
              icon={<BellOutlined />}
              className="topnavbar__action"
            />
          </Badge>
        </Tooltip>

        {/* Theme Toggle */}
        <Tooltip title={isDark ? 'Light mode' : 'Dark mode'}>
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            className="topnavbar__action"
          />
        </Tooltip>

        {/* User */}
        <Dropdown menu={userMenuItems} trigger={['click']} placement="bottomRight">
          <button className="topnavbar__user">
            <Avatar
              size={28}
              icon={<UserOutlined />}
              style={{ background: 'var(--color-primary)' }}
            />
            {user && <span className="topnavbar__user-name">{user.name}</span>}
          </button>
        </Dropdown>
      </div>
    </header>
  );
}
