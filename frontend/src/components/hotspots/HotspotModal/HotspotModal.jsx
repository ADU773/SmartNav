/**
 * SmartNav360 — HotspotModal
 * Modal for connecting two scenes.
 */

import { Modal, Form, Select, Input, InputNumber } from 'antd';
import { AimOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useState } from 'react';
import './HotspotModal.css';

export default function HotspotModal({
  open,
  onClose,
  onSubmit,
  scenes = [],
  sourceScene,
  coordinates,
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await onSubmit(values);
      form.resetFields();
      onClose();
    } catch {
      // Validation failed
    } finally {
      setLoading(false);
    }
  };

  const sceneOptions = scenes
    .filter(scene => scene._id !== sourceScene?._id)
    .map(scene => ({
      value: scene._id,
      label: scene.name,
    }));

  const yaw = Number.isFinite(coordinates?.yaw) ? coordinates.yaw : 0;
  const pitch = Number.isFinite(coordinates?.pitch) ? coordinates.pitch : 0;
  const hasSelectedPosition = Number.isFinite(coordinates?.yaw) && Number.isFinite(coordinates?.pitch);

  // Map yaw (-PI..PI) onto a 360° compass dial for a quick visual sanity-check of the pin's position.
  const compassAngle = (yaw * 180) / Math.PI;

  return (
    <Modal
      title={
        <span>
          <EnvironmentOutlined style={{ color: 'var(--color-primary)', marginRight: 8 }} />
          Connect Scenes
        </span>
      }
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="Create Connection"
      confirmLoading={loading}
      destroyOnHidden
      centered
      width={540}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        style={{ marginTop: 16 }}
        initialValues={{ distance: 0 }}
      >
        <div className={`hotspot-modal__position ${hasSelectedPosition ? 'is-set' : 'is-default'}`}>
          <div className="hotspot-modal__compass" style={{ '--pin-angle': `${compassAngle}deg` }}>
            <div className="hotspot-modal__compass-pin">
              <AimOutlined />
            </div>
          </div>
          <div className="hotspot-modal__position-info">
            <strong>{hasSelectedPosition ? 'Pin placed on panorama' : 'No pin placed yet'}</strong>
            <div className="hotspot-modal__position-coords">
              <span>Yaw {yaw.toFixed(2)}</span>
              <span>Pitch {pitch.toFixed(2)}</span>
            </div>
            {!hasSelectedPosition && (
              <small>Close this dialog and click the panorama to drop a precise pin, or continue with the center point.</small>
            )}
          </div>
        </div>

        <Form.Item
          name="targetSceneId"
          label="Leads to"
          rules={[{ required: true, message: 'Select the destination scene' }]}
        >
          <Select
            placeholder="Select destination scene"
            options={sceneOptions}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Form.Item name="label" label="Connection Label">
            <Input placeholder="e.g. Go to Lobby, Enter Room 101" />
          </Form.Item>

          <Form.Item name="distance" label="Distance (m)">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
