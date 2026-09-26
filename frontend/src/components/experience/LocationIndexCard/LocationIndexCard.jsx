/**
 * SmartNav360 — LocationIndexCard
 * Shows how much of a project is ready for "Where am I?" and lets the owner
 * prepare it ahead of time, so visitors to a published tour never wait for
 * indexing on their first search.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Progress, Space, Typography } from 'antd';
import { CompassOutlined, ThunderboltOutlined } from '@ant-design/icons';
import LocateService from '../../../services/locate.service';
import { useNotification } from '../../../contexts/NotificationContext';

export default function LocationIndexCard({ projectId }) {
  const { success, error } = useNotification();
  const [status, setStatus] = useState(null);
  const [building, setBuilding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await LocateService.status(projectId);
      setStatus(result.data);
    } catch {
      setStatus(null);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const build = async () => {
    setBuilding(true);
    try {
      const result = await LocateService.buildIndex(projectId);
      const { newlyIndexed, skipped } = result.data;
      success(
        'Location index ready',
        `${newlyIndexed} scene${newlyIndexed === 1 ? '' : 's'} indexed.${skipped.length ? ` ${skipped.length} skipped: ${skipped.map((s) => s.name).join(', ')}.` : ''}`,
      );
      await refresh();
    } catch (err) {
      error('Could not build the location index', err.message);
    } finally {
      setBuilding(false);
    }
  };

  const total = status?.scenesWithImages || 0;
  const ready = status?.indexed || 0;

  return (
    <Card
      size="small"
      style={{ marginTop: 20 }}
      title={<Space><CompassOutlined /> &ldquo;Where am I?&rdquo; location index</Space>}
    >
      <Typography.Paragraph type="secondary">
        Visitors can photograph their surroundings to find which scene they are in and which way they face.
        Each scene&apos;s panorama is indexed once; preparing it now saves visitors the wait.
      </Typography.Paragraph>
      {status && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Progress percent={total ? Math.round((ready / total) * 100) : 0} size="small" format={() => `${ready}/${total}`} />
          <Button icon={<ThunderboltOutlined />} loading={building} onClick={build} disabled={total === 0 || ready === total}>
            {ready === total && total > 0 ? 'Index is up to date' : 'Prepare location index'}
          </Button>
        </Space>
      )}
    </Card>
  );
}
