/**
 * SmartNav360 — HotspotModal
 * Modal for connecting two scenes.
 */

import { Modal, Form, Select, Input, InputNumber } from 'antd';
import { useState } from 'react';

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

  return (
    <Modal
      title="Connect Scenes"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="Create Connection"
      confirmLoading={loading}
      destroyOnHidden
      centered
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        style={{ marginTop: 16 }}
        initialValues={{ distance: 0 }}
      >

        <Form.Item
          name="targetSceneId"
          label="Target Scene"
          rules={[{ required: true, message: 'Select the target scene' }]}
        >
          <Select
            placeholder="Select target scene"
            options={sceneOptions}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="label" label="Connection Label">
          <Input placeholder="e.g. Go to Lobby, Enter Room 101" />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

          <div
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <strong>{hasSelectedPosition ? 'Selected Position' : 'Default Position'}</strong>

            <div>
              Yaw: {yaw.toFixed(3)}
            </div>

            <div>
              Pitch: {pitch.toFixed(3)}
            </div>
            {!hasSelectedPosition && <small>Click the panorama to place this hotspot precisely.</small>}
          </div>

          <Form.Item name="distance" label="Distance (m)">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
