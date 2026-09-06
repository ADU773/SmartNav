/**
 * SmartNav360 — EmptyState
 * Reusable empty state with icon, message, and optional action.
 */

import { Button } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import './EmptyState.css';

export default function EmptyState({
  icon,
  title = 'No data yet',
  description = '',
  actionLabel,
  onAction,
  actionIcon,
}) {
  const IconComponent = icon || InboxOutlined;

  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <IconComponent />
      </div>
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__description">{description}</p>}
      {actionLabel && onAction && (
        <Button
          type="primary"
          icon={actionIcon}
          onClick={onAction}
          className="empty-state__action"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
