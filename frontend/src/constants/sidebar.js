/**
 * SmartNav360 — Sidebar Navigation Configuration
 * Defines sidebar menu structure with grouping and icons.
 */

import {
  DashboardOutlined,
  PictureOutlined,
  AppstoreOutlined,
  NodeIndexOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  RobotOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { ROUTES } from './routes';

export const SIDEBAR_GROUPS = [
  {
    key: 'workspace',
    label: 'Workspace',
    items: [
      {
        key: 'dashboard',
        label: 'Dashboard',
        icon: DashboardOutlined,
        path: ROUTES.DASHBOARD,
      },
      {
        key: 'assets',
        label: 'Assets',
        icon: PictureOutlined,
        path: ROUTES.ASSETS,
      },
      {
        key: 'scenes',
        label: 'Scenes',
        icon: AppstoreOutlined,
        path: ROUTES.SCENES,
      },
      {
        key: 'hotspots',
        label: 'Hotspots',
        icon: NodeIndexOutlined,
        path: ROUTES.HOTSPOTS,
      },
      {
        key: 'map',
        label: 'Map Editor',
        icon: EnvironmentOutlined,
        path: ROUTES.MAP,
      },
    ],
  },
  {
    key: 'experience',
    label: 'Experience',
    items: [
      {
        key: 'experience',
        label: 'Virtual Experience',
        icon: EyeOutlined,
        path: ROUTES.EXPERIENCE,
      },
      {
        key: 'ai',
        label: 'AI Workspace',
        icon: RobotOutlined,
        path: ROUTES.AI,
      },
    ],
  },
  {
    key: 'manage',
    label: 'Manage',
    items: [
      {
        key: 'analytics',
        label: 'Analytics',
        icon: BarChartOutlined,
        path: ROUTES.ANALYTICS,
      },
      {
        key: 'deployment',
        label: 'Deployment',
        icon: CloudUploadOutlined,
        path: ROUTES.DEPLOYMENT,
      },
      {
        key: 'settings',
        label: 'Settings',
        icon: SettingOutlined,
        path: ROUTES.SETTINGS,
      },
    ],
  },
];
