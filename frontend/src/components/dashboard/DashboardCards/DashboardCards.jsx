/**
 * SmartNav360 — DashboardCards
 * Statistics summary cards for the dashboard.
 */

import { Card, Row, Col } from 'antd';
import {
  AppstoreOutlined,
  PictureOutlined,
  EyeOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import './DashboardCards.css';

const STAT_CONFIG = [
  { key: 'projects', label: 'Projects', icon: AppstoreOutlined, color: '#2563eb' },
  { key: 'scenes', label: 'Scenes', icon: EyeOutlined, color: '#16a34a' },
  { key: 'assets', label: 'Assets', icon: PictureOutlined, color: '#d97706' },
  { key: 'connections', label: 'Connections', icon: NodeIndexOutlined, color: '#7c3aed' },
];

export default function DashboardCards({ stats = {} }) {
  return (
    <Row gutter={[16, 16]}>
      {STAT_CONFIG.map((item) => (
        <Col xs={12} sm={12} md={6} key={item.key}>
          <Card className="stat-card">
            <div className="stat-card__header">
              <span className="stat-card__label">{item.label}</span>
              <div
                className="stat-card__icon"
                style={{ background: `${item.color}12`, color: item.color }}
              >
                <item.icon />
              </div>
            </div>
            <div className="stat-card__value">
              {stats[item.key] ?? 0}
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
