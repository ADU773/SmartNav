/**
 * SmartNav360 — TopNavbar
 * Top navigation bar with breadcrumb, project switcher, quick-jump search,
 * theme toggle, and user profile.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Breadcrumb, AutoComplete, Input, Button, Dropdown, Avatar, Tooltip, Badge } from 'antd';
import {
  SearchOutlined,
  BellOutlined,
  SunOutlined,
  MoonOutlined,
  UserOutlined,
  SwapOutlined,
  LogoutOutlined,
  SettingOutlined,
  MenuOutlined,
  CheckOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { SIDEBAR_GROUPS } from '../../../constants/sidebar';
import { useProject } from '../../../contexts/ProjectContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import './TopNavbar.css';

// Flatten the sidebar's grouped nav config once for breadcrumb lookup + quick-jump search.
const NAV_ITEMS = SIDEBAR_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label }))
);

export default function TopNavbar({ onMenuClick }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProject, projects, selectProject } = useProject();
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [searchValue, setSearchValue] = useState('');

  const activeKey = location.pathname.split('/')[1] || 'dashboard';
  const activeNavItem = NAV_ITEMS.find((item) => item.key === activeKey);

  const searchOptions = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        value: item.label,
        path: item.path,
        label: (
          <span className="topnavbar__search-option">
            <item.icon /> {item.label}
            <span className="topnavbar__search-option-group">{item.group}</span>
          </span>
        ),
      })),
    []
  );

  const handleSearchSelect = (_, option) => {
    navigate(option.path);
    setSearchValue('');
  };

  const projectMenuItems = {
    items: [
      ...projects.map((project) => ({
        key: project._id,
        label: project.name,
        icon: project._id === currentProject?._id ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />,
        onClick: () => selectProject(project),
      })),
      ...(projects.length ? [{ type: 'divider' }] : []),
      {
        key: 'all-projects',
        icon: <AppstoreOutlined />,
        label: 'All Projects',
        onClick: () => navigate('/'),
      },
    ],
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
        <button
          type="button"
          className="topnavbar__hamburger"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <MenuOutlined />
        </button>

        <Breadcrumb
          items={[
            { title: currentProject?.name || 'SmartNav360' },
            ...(activeNavItem ? [{ title: activeNavItem.label }] : []),
          ]}
        />
      </div>

      <div className="topnavbar__right">
        {/* Project Switcher */}
        <Dropdown menu={projectMenuItems} trigger={['click']} placement="bottomRight">
          <Tooltip title="Switch project">
            <Button
              type="text"
              icon={<SwapOutlined />}
              className="topnavbar__action"
            />
          </Tooltip>
        </Dropdown>

        {/* Quick-jump Search */}
        <div className="topnavbar__search">
          <AutoComplete
            value={searchValue}
            onChange={setSearchValue}
            onSelect={handleSearchSelect}
            options={searchOptions.filter((opt) =>
              opt.value.toLowerCase().includes(searchValue.toLowerCase())
            )}
            className="topnavbar__search-input"
            popupMatchSelectWidth={260}
          >
            <Input prefix={<SearchOutlined />} placeholder="Jump to..." size="small" allowClear />
          </AutoComplete>
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
