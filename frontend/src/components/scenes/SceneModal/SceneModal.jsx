/**
 * SmartNav360 — SceneModal
 * Modal for creating a new scene: a name, plus a panorama chosen visually
 * from the project's uploaded images.
 */

import { Modal, Form, Input } from 'antd';
import { useState } from 'react';
import AssetPicker from '../../common/AssetPicker';

export default function SceneModal({ open, onClose, onSubmit, projectId, assets = [] }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await onSubmit({ ...values, projectId });
      form.resetFields();
      onClose();
    } catch {
      // Validation errors are shown inline; submit errors are reported by onSubmit.
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Create Scene"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="Create Scene"
      confirmLoading={loading}
      destroyOnHidden
      centered
      width={720}
    >
      <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="Scene Name"
          rules={[{ required: true, message: 'Please enter a scene name' }]}
        >
          <Input placeholder="e.g. Main Entrance, Reception Hall" />
        </Form.Item>

        <Form.Item
          name="image"
          label="Panorama Image"
          extra="Pick a 360° image. Wide 2:1 images are the ones that wrap all the way around."
        >
          <AssetPicker assets={assets} preferPanoramic />
        </Form.Item>
      </Form>
    </Modal>
  );
}
