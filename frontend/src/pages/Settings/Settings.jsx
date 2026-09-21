/**
 * SmartNav360 — Settings Page
 * Professional settings page with sections for project, appearance, and danger zone.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Switch, Select, Button, Divider, Tag } from 'antd';
import {
  SettingOutlined,
  BgColorsOutlined,
  LockOutlined,
  DeleteOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotification } from '../../contexts/NotificationContext';
import { MESSAGES } from '../../constants/messages';
import ProjectService from '../../services/project.service';
import { showConfirmDialog } from '../../components/common/ConfirmDialog';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './Settings.css';

export default function Settings() {
  useDocumentTitle('Settings');

  const navigate = useNavigate();
  const { currentProject, selectProject, clearProject } = useProject();
  const { isDark, toggleTheme } = useTheme();
  const { success, error } = useNotification();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSaveProject = async (values) => {
    if (!currentProject?._id) return;
    setSaving(true);
    try {
      const result = await ProjectService.updateProject(currentProject._id, values);
      if (result.success) {
        selectProject({ ...currentProject, ...result.data });
        success(MESSAGES.PROJECT_UPDATED);
      }
    } catch (err) {
      error(MESSAGES.PROJECT_UPDATE_ERROR, err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = () => {
    if (!currentProject?._id) return;
    showConfirmDialog({
      title: 'Delete Project',
      content: `Are you sure you want to delete "${currentProject.name}"? All scenes, assets, and connections will be permanently removed. This action cannot be undone.`,
      okText: 'Delete Project',
      onConfirm: async () => {
        setDeleting(true);
        try {
          const result = await ProjectService.deleteProject(currentProject._id);
          if (result.success) {
            success(MESSAGES.PROJECT_DELETED);
            clearProject();
            navigate('/');
          }
        } catch (err) {
          error(MESSAGES.PROJECT_DELETE_ERROR, err.message);
        } finally {
          setDeleting(false);
        }
      },
    });
  };

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
        {currentProject ? (
          <Form
            layout="vertical"
            requiredMark="optional"
            initialValues={{ name: currentProject?.name, description: currentProject?.description }}
            onFinish={handleSaveProject}
          >
            <Form.Item
              name="name"
              label="Project Name"
              rules={[{ required: true, message: 'Project name is required' }]}
            >
              <Input placeholder="Project name" />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <Input.TextArea placeholder="Project description" rows={3} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>Save Changes</Button>
          </Form>
        ) : (
          <p className="settings__empty-note">Select a project from the sidebar to manage its settings.</p>
        )}
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
          <Tag>Coming Soon</Tag>
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
          <Tag>Planned</Tag>
        </div>
        <Divider />
        <div className="settings__option">
          <div>
            <h4>User Roles</h4>
            <p>Manage admin, editor, and viewer roles.</p>
          </div>
          <Tag>Planned</Tag>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card
        title={<span className="settings__danger-title"><DeleteOutlined /> Danger Zone</span>}
        className="settings__card settings__card--danger"
      >
        <div className="settings__option">
          <div>
            <h4>Delete Project</h4>
            <p>Permanently delete this project and all associated data. This action cannot be undone.</p>
          </div>
          <Button danger loading={deleting} disabled={!currentProject} onClick={handleDeleteProject}>
            Delete Project
          </Button>
        </div>
      </Card>
    </div>
  );
}
