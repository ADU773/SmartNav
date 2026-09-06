import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Statistic, Table, Tag } from 'antd';
import { EyeOutlined, NodeIndexOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useProject } from '../../contexts/ProjectContext';
import FeatureService from '../../services/feature.service';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './Analytics.css';

export default function Analytics() {
  useDocumentTitle('Analytics');
  const { currentProject } = useProject();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!currentProject?._id) return;
    setLoading(true);
    FeatureService.getAnalytics(currentProject._id).then((result) => setData(result.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [currentProject?._id]);
  return <div className="analytics">
    <WorkspaceHeader title="Visitor Analytics" description="Live interaction data from this project's virtual experience." />
    {!currentProject ? <Empty description="Choose a project to view its analytics." /> : <>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}><Card loading={loading}><Statistic title="Visitors" value={data?.visitors || 0} prefix={<TeamOutlined />} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading}><Statistic title="Scene views" value={data?.sceneViews?.reduce((sum, item) => sum + item.views, 0) || 0} prefix={<EyeOutlined />} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading}><Statistic title="Navigation events" value={data?.navigationCount || 0} prefix={<NodeIndexOutlined />} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading}><Statistic title="Total interactions" value={data?.totalEvents || 0} prefix={<ThunderboltOutlined />} /></Card></Col>
      </Row>
      <Card title="Most viewed scenes" style={{ marginTop: 16 }} loading={loading}>
        <Table rowKey="sceneId" pagination={false} dataSource={data?.sceneViews || []} columns={[{ title: 'Scene', dataIndex: 'name' }, { title: 'Views', dataIndex: 'views', render: (value) => <Tag color="blue">{value}</Tag> }]} locale={{ emptyText: 'Open the Virtual Experience to begin collecting views.' }} />
      </Card>
    </>}
  </div>;
}
