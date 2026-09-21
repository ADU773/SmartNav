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
  { key: 'projects', label: 'Projects', icon: AppstoreOutlined, colorVar: '--color-primary', bgVar: '--color-primary-light' },
  { key: 'scenes', label: 'Scenes', icon: EyeOutlined, colorVar: '--color-success', bgVar: '--color-success-light' },
  { key: 'assets', label: 'Assets', icon: PictureOutlined, colorVar: '--color-warning', bgVar: '--color-warning-light' },
  { key: 'connections', label: 'Connections', icon: NodeIndexOutlined, colorVar: '--color-accent-purple', bgVar: '--color-accent-purple-light' },
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
                style={{ background: `var(${item.bgVar})`, color: `var(${item.colorVar})` }}
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
