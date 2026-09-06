/**
 * SmartNav360 — ProjectCard
 * Displays a project summary card for the project selection page.
 */

import { Card, Tag } from 'antd';
import { AppstoreOutlined, CalendarOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { formatRelativeDate } from '../../../utils/formatDate';
import './ProjectCard.css';

export default function ProjectCard({ project, onClick }) {
  return (
    <Card
      className="project-card"
      hoverable
      onClick={() => onClick(project)}
    >
      <div className="project-card__header">
        <div className="project-card__avatar">
          {project.name?.charAt(0)?.toUpperCase()}
        </div>
        <ArrowRightOutlined className="project-card__arrow" />
      </div>

      <h3 className="project-card__name">{project.name}</h3>

      {project.description && (
        <p className="project-card__description">{project.description}</p>
      )}

      <div className="project-card__meta">
        <span className="project-card__meta-item">
          <CalendarOutlined />
          {formatRelativeDate(project.createdAt)}
        </span>
        <Tag color="blue" className="project-card__tag">
          <AppstoreOutlined /> Project
        </Tag>
      </div>
    </Card>
  );
}
