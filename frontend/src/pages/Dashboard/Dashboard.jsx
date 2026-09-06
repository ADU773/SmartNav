/**
 * SmartNav360 — Dashboard Page
 * Complete workspace overview with statistics, quick actions, and status.
 */

import { useState, useEffect } from 'react';
import { Card, Row, Col, Timeline, Tag } from 'antd';
import {
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useProject } from '../../contexts/ProjectContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import SceneService from '../../services/scene.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import DashboardCards from '../../components/dashboard/DashboardCards';
import QuickActions from '../../components/dashboard/QuickActions';
import './Dashboard.css';

export default function Dashboard() {
  useDocumentTitle('Dashboard');

  const { currentProject, projects } = useProject();
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await SceneService.getScenes();
        if (result.success) {
          setScenes(result.data || []);
        }
      } catch {
        // Gracefully handle
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const projectScenes = currentProject
    ? scenes.filter((s) => s.projectId === currentProject._id)
    : scenes;

  const totalConnections = projectScenes.reduce(
    (acc, scene) => acc + (scene.hotspots?.length || 0),
    0
  );

  const stats = {
    projects: projects.length,
    scenes: projectScenes.length,
    assets: projectScenes.filter((s) => s.image).length,
    connections: totalConnections,
  };

  return (
    <div className="dashboard">
      <WorkspaceHeader
        title="Dashboard"
        description={
          currentProject
            ? `Overview for ${currentProject.name}`
            : 'Welcome to SmartNav360'
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
                  <span className="dashboard__info-value">{projectScenes.length}</span>
                </div>
                <div className="dashboard__info-item">
                  <span className="dashboard__info-label">Connections</span>
                  <span className="dashboard__info-value">{totalConnections}</span>
                </div>
              </div>
            </Card>
          )}
        </Col>

        <Col xs={24} lg={8}>
          {/* Framework Status */}
          <Card title="Framework Status" className="dashboard__card">
            <div className="dashboard__status-list">
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Project Management</span>
                <Tag color="green">Active</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Scene Builder</span>
                <Tag color="green">Active</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Asset Manager</span>
                <Tag color="green">Active</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Marzipano Viewer</span>
                <Tag color="green">Active</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Gemini AI</span>
                <Tag color="blue">Key optional</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Analytics</span>
                <Tag color="green">Active</Tag>
              </div>
              <div className="dashboard__status-item">
                <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
                <span>Deployment</span>
                <Tag color="green">Active</Tag>
              </div>
            </div>
          </Card>

          {/* Upcoming */}
          <Card title="Feature Delivery" className="dashboard__card" style={{ marginTop: 16 }}>
            <Timeline
              items={[
                { children: 'Marzipano 360° Viewer Integration', color: 'green' },
                { children: 'Gemini AI Navigation Assistant', color: 'green' },
                { children: 'YOLO Computer Vision Detection service integration', color: 'green' },
                { children: 'Graph-Based Shortest Path Navigation', color: 'green' },
                { children: 'Publishing, share links, and export', color: 'green' },
                { children: 'Visitor Analytics Dashboard', color: 'green' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
