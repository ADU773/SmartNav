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
                { title: 'Views', dataIndex: 'views', render: (value) => <Tag color="blue">{value}</Tag> },
              ]}
              locale={{ emptyText: 'Open the Virtual Experience to begin collecting views.' }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
