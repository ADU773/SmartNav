/**
 * SmartNav360 — Analytics Page
 * Live interaction data collected from the virtual experience.
 */

import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Statistic, Table, Tag } from 'antd';
import { EyeOutlined, NodeIndexOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import FeatureService from '../../services/feature.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './Analytics.css';

/** Renders a millisecond duration as a short human string. */
function formatDwell(ms) {
  if (!ms) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const STAT_TILES = [
  { key: 'visitors', title: 'Visitors', icon: TeamOutlined, accent: 'primary', getValue: (data) => data?.visitors || 0 },
  { key: 'sceneViews', title: 'Scene views', icon: EyeOutlined, accent: 'success', getValue: (data) => data?.sceneViews?.reduce((sum, item) => sum + item.views, 0) || 0 },
  { key: 'navigation', title: 'Navigation events', icon: NodeIndexOutlined, accent: 'warning', getValue: (data) => data?.navigationCount || 0 },
  { key: 'interactions', title: 'Total interactions', icon: ThunderboltOutlined, accent: 'purple', getValue: (data) => data?.totalEvents || 0 },
];

export default function Analytics() {
  useDocumentTitle('Analytics');
  const { currentProject } = useProject();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentProject?._id) return;
    setLoading(true);
    FeatureService.getAnalytics(currentProject._id)
      .then((result) => setData(result.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [currentProject?._id]);

  return (
    <div className="analytics">
      <WorkspaceHeader
        title="Visitor Analytics"
        description="Live interaction data from this project's virtual experience."
      />

      {!currentProject ? (
        <Empty description="Choose a project to view its analytics." />
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {STAT_TILES.map((tile) => (
              <Col xs={24} sm={12} lg={6} key={tile.key}>
                <Card loading={loading} className={`analytics__tile analytics__tile--${tile.accent}`}>
                  <div className="analytics__tile-icon">
                    <tile.icon />
                  </div>
                  <Statistic title={tile.title} value={tile.getValue(data)} />
                </Card>
              </Col>
            ))}
          </Row>

          <Card title="Most viewed scenes" style={{ marginTop: 16 }} loading={loading}>
            <Table
              rowKey="sceneId"
              pagination={false}
              dataSource={data?.sceneViews || []}
              columns={[
                { title: 'Scene', dataIndex: 'name' },
                { title: 'Views', dataIndex: 'views', render: (value) => <Tag>{value}</Tag> },
                {
                  title: 'Avg. dwell',
                  dataIndex: 'averageDwellMs',
                  // Measured as the gap to the visitor's next event in the same
                  // session; the last view of a session has no successor, so it
                  // is excluded rather than counted as zero.
                  render: (value) => formatDwell(value),
                },
              ]}
              locale={{ emptyText: 'Open the Virtual Experience to begin collecting views.' }}
            />
          </Card>

          <Card title="Most walked connections" style={{ marginTop: 16 }} loading={loading}>
            <Table
              rowKey={(row) => `${row.from}-${row.to}`}
              pagination={false}
              dataSource={data?.transitions || []}
              columns={[
                { title: 'From', dataIndex: 'fromName' },
                { title: 'To', dataIndex: 'toName' },
                { title: 'Times walked', dataIndex: 'count', render: (value) => <Tag>{value}</Tag> },
              ]}
              locale={{ emptyText: 'No navigation between scenes recorded yet.' }}
            />
          </Card>

          <Card title="Activity by day" style={{ marginTop: 16 }} loading={loading}>
            <Table
              rowKey="date"
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={data?.timeline || []}
              columns={[
                { title: 'Date', dataIndex: 'date' },
                { title: 'Events', dataIndex: 'count' },
              ]}
              locale={{ emptyText: 'No activity recorded yet.' }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
