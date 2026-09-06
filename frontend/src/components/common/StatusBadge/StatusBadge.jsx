/**
 * SmartNav360 — StatusBadge
 * Colored status indicator.
 */

import { Tag } from 'antd';

const STATUS_CONFIG = {
  active: { color: 'green', label: 'Active' },
  inactive: { color: 'default', label: 'Inactive' },
  pending: { color: 'orange', label: 'Pending' },
  error: { color: 'red', label: 'Error' },
  ready: { color: 'blue', label: 'Ready' },
  draft: { color: 'default', label: 'Draft' },
  published: { color: 'green', label: 'Published' },
  coming_soon: { color: 'purple', label: 'Coming Soon' },
  planned: { color: 'cyan', label: 'Planned' },
};

export default function StatusBadge({ status = 'active', label }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.active;

  return (
    <Tag color={config.color}>
      {label || config.label}
    </Tag>
  );
}
