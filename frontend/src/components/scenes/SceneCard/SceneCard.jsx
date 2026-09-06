/**
 * SmartNav360 — SceneCard
 * Displays a scene summary card with preview, hotspot count, and actions.
 */

import { Card, Button, Tooltip, Tag } from 'antd';
import {
  EyeOutlined,
  DeleteOutlined,
  NodeIndexOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { getImageUrl } from '../../../utils/getImageUrl';
import { formatRelativeDate } from '../../../utils/formatDate';
import './SceneCard.css';

export default function SceneCard({ scene, onView, onDelete }) {
  const imageUrl = getImageUrl(scene.image);
  const hotspotCount = scene.hotspots?.length || 0;

  return (
    <Card
      className="scene-card"
      cover={
        <div className="scene-card__cover">
          {imageUrl ? (
            <img src={imageUrl} alt={scene.name} className="scene-card__image" />
          ) : (
            <div className="scene-card__placeholder">
              <EyeOutlined />
              <span>No preview</span>
            </div>
          )}
        </div>
      }
      actions={[
        <Tooltip title="Open in Experience" key="view">
          <Button type="text" icon={<EyeOutlined />} onClick={() => onView?.(scene)}>
            View
          </Button>
        </Tooltip>,
        <Tooltip title="Delete Scene" key="delete">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete?.(scene)}>
            Delete
          </Button>
        </Tooltip>,
      ]}
    >
      <h4 className="scene-card__name">{scene.name}</h4>
      <div className="scene-card__meta">
        <span className="scene-card__meta-item">
          <NodeIndexOutlined />
          {hotspotCount} {hotspotCount === 1 ? 'connection' : 'connections'}
        </span>
        <span className="scene-card__meta-item">
          <CalendarOutlined />
          {formatRelativeDate(scene.createdAt)}
        </span>
      </div>
      {hotspotCount > 0 && (
        <Tag color="blue" className="scene-card__tag">Connected</Tag>
      )}
    </Card>
  );
}
