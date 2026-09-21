/**
 * SmartNav360 — HotspotTable
 * Table displaying scene connections (hotspots).
 */

import { Table, Button, Tag, Tooltip, Space } from 'antd';
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons';

export default function HotspotTable({ scenes = [], loading, onDelete, onLocate }) {
  // Flatten hotspots from all scenes into a table-friendly format
  const connections = scenes.flatMap((scene) =>
    (scene.hotspots || []).map((hotspot, index) => ({
      key: `${scene._id}-${index}`,
      hotspotIndex: index,
      sourceSceneId: scene._id,
      sourceSceneName: scene.name,
      targetSceneId: hotspot.targetScene,
      targetSceneName:
        scenes.find((s) => s._id === hotspot.targetScene)?.name || 'Unknown',
      label: hotspot.label || '—',
      yaw: hotspot.yaw ?? 0,
      pitch: hotspot.pitch ?? 0,
      distance: hotspot.distance ?? 0,
    }))
  );

  const columns = [
    {
      title: 'Source Scene',
      dataIndex: 'sourceSceneName',
      key: 'source',
      sorter: (a, b) => a.sourceSceneName.localeCompare(b.sourceSceneName),
    },
    {
      title: 'Target Scene',
      dataIndex: 'targetSceneName',
      key: 'target',
      sorter: (a, b) => a.targetSceneName.localeCompare(b.targetSceneName),
    },
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: 'Yaw',
      dataIndex: 'yaw',
      key: 'yaw',
      width: 80,
      render: (val) => <Tag>{val}°</Tag>,
    },
    {
      title: 'Pitch',
      dataIndex: 'pitch',
      key: 'pitch',
      width: 80,
      render: (val) => <Tag>{val}°</Tag>,
    },
    {
      title: 'Distance',
      dataIndex: 'distance',
      key: 'distance',
      width: 90,
      render: (val) => `${val}m`,
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="View in editor">
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => onLocate?.(record)}
            />
          </Tooltip>
          <Tooltip title="Remove connection">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              size="small"
              onClick={() => onDelete?.(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={connections}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: true }}
      locale={{ emptyText: 'No connections yet. Connect scenes to create navigation paths.' }}
      size="middle"
      scroll={{ x: 700 }}
    />
  );
}
