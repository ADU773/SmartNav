/**
 * SmartNav360 — Deployment Page
 * Publish the virtual experience as a shareable link, or export the project as JSON.
 */

import { useState } from 'react';
import { Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { DownloadOutlined, GlobalOutlined, LinkOutlined, RocketOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import FeatureService from '../../services/feature.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './Deployment.css';

export default function Deployment() {
  useDocumentTitle('Deployment');

  const { currentProject } = useProject();
  const { success, error } = useNotification();
  const [publishing, setPublishing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const publish = async () => {
    if (!currentProject?._id) return;
    setPublishing(true);
    try {
      const result = await FeatureService.publishProject(currentProject._id);
      const url = `${window.location.origin}/experience?share=${result.data.shareToken}`;
      setShareUrl(url);
      success('Project published. Your share link is ready.');
    } catch (err) {
      error('Publishing failed', err.message);
    } finally {
      setPublishing(false);
    }
  };

  const exportProject = async () => {
    try {
      const result = await FeatureService.exportProject(currentProject._id);
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentProject.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-export.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      success('Project export downloaded.');
    } catch (err) {
      error('Export failed', err.message);
    }
  };

  return (
    <div className="deployment">
      <WorkspaceHeader
        title="Publish & Export"
        description="Share the virtual experience or download a portable project backup."
      />

      {!currentProject ? (
        <Empty description="Choose a project before publishing." />
      ) : (
        <Card
          className="deployment__card"
          title={
            <Space>
              <GlobalOutlined /> {currentProject.name} <Tag color="blue">Ready to publish</Tag>
            </Space>
          }
        >
          <Typography.Paragraph>
            Publishing creates a reusable share token for this project. You can also export its project, scenes, and hotspot configuration as JSON.
          </Typography.Paragraph>
          <Space wrap>
            <Button type="primary" icon={<RocketOutlined />} loading={publishing} onClick={publish}>
              Publish experience
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportProject}>
              Export project JSON
            </Button>
          </Space>

          {shareUrl && (
            <Card size="small" style={{ marginTop: 20 }} title={<Space><LinkOutlined /> Share link</Space>}>
              <Typography.Paragraph copyable={{ text: shareUrl }}>{shareUrl}</Typography.Paragraph>
            </Card>
          )}
        </Card>
      )}
    </div>
  );
}
