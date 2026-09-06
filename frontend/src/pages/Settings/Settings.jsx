/**
 * SmartNav360 — Settings Page
 * Professional settings page with sections for project, appearance, and danger zone.
 */

import { Card, Form, Input, Switch, Select, Button, Divider, Tag } from 'antd';
import {
  SettingOutlined,
  BgColorsOutlined,
  LockOutlined,
  DeleteOutlined,
  TeamOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useTheme } from '../../contexts/ThemeContext';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './Settings.css';

export default function Settings() {
  useDocumentTitle('Settings');

  const { currentProject } = useProject();
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="settings">
      <WorkspaceHeader
        title="Settings"
        description="Manage project settings, appearance, and configuration."
      />

      {/* Project Settings */}
      <Card
        title={<><SettingOutlined /> Project Settings</>}
        className="settings__card"
      >
        <Form layout="vertical" requiredMark="optional">
          <Form.Item label="Project Name">
            <Input
              defaultValue={currentProject?.name}
              placeholder="Project name"
            />
          </Form.Item>
          <Form.Item label="Description">
            <Input.TextArea
              defaultValue={currentProject?.description}
              placeholder="Project description"
              rows={3}
            />
          </Form.Item>
          <Button type="primary">Save Changes</Button>
        </Form>
      </Card>

      {/* Appearance */}
      <Card
        title={<><BgColorsOutlined /> Appearance</>}
        className="settings__card"
      >
        <div className="settings__option">
          <div>
            <h4>Dark Mode</h4>
            <p>Switch between light and dark theme.</p>
          </div>
          <Switch checked={isDark} onChange={toggleTheme} />
        </div>
        <Divider />
        <div className="settings__option">
          <div>
            <h4>Language</h4>
            <p>Select your preferred language.</p>
          </div>
          <Select defaultValue="en" style={{ width: 160 }}>
            <Select.Option value="en">English</Select.Option>
            <Select.Option value="es" disabled>Spanish (Coming Soon)</Select.Option>
            <Select.Option value="fr" disabled>French (Coming Soon)</Select.Option>
          </Select>
        </div>
      </Card>

      {/* Branding */}
      <Card
        title={<><GlobalOutlined /> Branding</>}
        className="settings__card"
      >
        <div className="settings__option">
          <div>
            <h4>Organization Branding</h4>
            <p>Customize logos and colors for your virtual experience.</p>
          </div>
          <Tag color="purple">Coming Soon</Tag>
        </div>
      </Card>

      {/* Authentication */}
      <Card
        title={<><LockOutlined /> Authentication</>}
        className="settings__card"
      >
        <div className="settings__option">
          <div>
            <h4>Authentication & Access Control</h4>
            <p>Configure JWT authentication, user roles, and permissions.</p>
          </div>
          <Tag color="orange">Planned</Tag>
        </div>
        <Divider />
        <div className="settings__option">
          <div>
            <h4>User Roles</h4>
            <p>Manage admin, editor, and viewer roles.</p>
          </div>
          <Tag color="orange">Planned</Tag>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card
        title={<span style={{ color: 'var(--color-error)' }}><DeleteOutlined /> Danger Zone</span>}
        className="settings__card settings__card--danger"
      >
        <div className="settings__option">
          <div>
            <h4>Delete Project</h4>
            <p>Permanently delete this project and all associated data. This action cannot be undone.</p>
          </div>
          <Button danger>Delete Project</Button>
        </div>
      </Card>
    </div>
  );
}
