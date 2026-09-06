/**
 * SmartNav360 — QuickActions
 * Dashboard quick action buttons for common workflows.
 */

import { Card, Button, Space } from 'antd';
import {
  PlusOutlined,
  UploadOutlined,
  EyeOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import './QuickActions.css';

const actions = [
  { key: 'scene', label: 'Create Scene', icon: <PlusOutlined />, path: '/scenes' },
  { key: 'upload', label: 'Upload Asset', icon: <UploadOutlined />, path: '/assets' },
  { key: 'experience', label: 'Virtual Experience', icon: <EyeOutlined />, path: '/experience' },
  { key: 'ai', label: 'AI Workspace', icon: <RobotOutlined />, path: '/ai' },
];

export default function QuickActions() {
  const navigate = useNavigate();

  return (
    <Card title="Quick Actions" className="quick-actions">
      <Space wrap>
        {actions.map((action) => (
          <Button
            key={action.key}
            icon={action.icon}
            onClick={() => navigate(action.path)}
          >
            {action.label}
          </Button>
        ))}
      </Space>
    </Card>
  );
}
