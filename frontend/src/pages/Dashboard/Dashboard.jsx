/**
 * SmartNav360 — Dashboard Page
 * Complete workspace overview with statistics, quick actions, and status.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, List, Tag } from 'antd';
import { CheckCircleFilled, ClockCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useProject } from '../../contexts/ProjectContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import SceneService from '../../services/scene.service';
import { formatRelativeDate } from '../../utils/formatDate';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import DashboardCards from '../../components/dashboard/DashboardCards';
import QuickActions from '../../components/dashboard/QuickActions';
import EmptyState from '../../components/common/EmptyState';
import './Dashboard.css';

export default function Dashboard() {
  useDocumentTitle('Dashboard');

  const navigate = useNavigate();
  const { currentProject, projects } = useProject();
  const [scenes, setScenes] = useState([]);

  useEffect(() => {
    if (!currentProject?._id) {
      setScenes([]);
      return;
    }
    SceneService.getScenes(currentProject._id)
      .then((result) => setScenes(result.success ? result.data || [] : []))
      .catch(() => setScenes([]));
  }, [currentProject?._id]);

  const totalConnections = scenes.reduce((acc, scene) => acc + (scene.hotspots?.length || 0), 0);
  const assetCount = scenes.filter((s) => s.image).length;

  const stats = {
    projects: projects.length,
    scenes: scenes.length,
    assets: assetCount,
    connections: totalConnections,
  };

  const recentScenes = [...scenes]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);

  const checklist = [
    { label: 'Upload panoramic assets', done: assetCount > 0, path: '/assets' },
    { label: 'Create your first scene', done: scenes.length > 0, path: '/scenes' },
    { label: 'Connect scenes with hotspots', done: totalConnections > 0, path: '/hotspots' },
    { label: 'Preview the virtual experience', done: scenes.length > 0, path: '/experience' },
    { label: 'Publish & share', done: false, path: '/deployment' },
  ];

  return (
    <div className="dashboard">
      <WorkspaceHeader
        title="Dashboard"
        description={
          currentProject
            ? `Overview for ${currentProject.name}`
            : 'Select a project from the sidebar to see its overview.'
        }
      />

      <DashboardCards stats={stats} />

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <QuickActions />

          {/* Project Info */}
          {currentProject && (
            <Card title="Project Information" className="dashboard__card" style={{ marginTop: 16 }}>
              <div className="dashboard__info-grid">
                <div className="dashboard__info-item">
                  <span className="dashboard__info-label">Name</span>
                  <span className="dashboard__info-value">{currentProject.name}</span>
                </div>
                <div className="dashboard__info-item">
                  <span className="dashboard__info-label">Description</span>
                  <span className="dashboard__info-value">
                    {currentProject.description || 'No description'}
                  </span>
                </div>
                <div className="dashboard__info-item">
                  <span className="dashboard__info-label">Scenes</span>
                  <span className="dashboard__info-value">{scenes.length}</span>
                </div>
                <div className="dashboard__info-item">
                  <span className="dashboard__info-label">Connections</span>
                  <span className="dashboard__info-value">{totalConnections}</span>
                </div>
              </div>
            </Card>
          )}

          {/* Recent Scenes */}
          <Card title="Recent Scenes" className="dashboard__card" style={{ marginTop: 16 }}>
            {recentScenes.length > 0 ? (
              <List
                dataSource={recentScenes}
                renderItem={(scene) => (
                  <List.Item
                    className="dashboard__recent-item"
                    onClick={() => navigate('/scenes')}
                  >
                    <span className="dashboard__recent-name">
                      <AppstoreOutlined /> {scene.name}
                    </span>
                    <span className="dashboard__recent-date">{formatRelativeDate(scene.createdAt)}</span>
                  </List.Item>
                )}
              />
            ) : (
              <EmptyState
                icon={AppstoreOutlined}
                title="No scenes yet"
                description={currentProject ? 'Create your first scene to see it here.' : 'Select a project to get started.'}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          {/* Setup Checklist */}
          <Card title="Setup Checklist" className="dashboard__card">
            <div className="dashboard__status-list">
              {checklist.map((step) => (
                <div
                  key={step.label}
                  className="dashboard__status-item dashboard__status-item--clickable"
                  onClick={() => navigate(step.path)}
                >
                  {step.done ? (
                    <CheckCircleFilled style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <ClockCircleOutlined style={{ color: 'var(--color-text-tertiary)' }} />
                  )}
                  <span>{step.label}</span>
                  <Tag color={step.done ? 'green' : 'default'}>{step.done ? 'Done' : 'To do'}</Tag>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
