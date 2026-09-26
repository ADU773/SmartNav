/**
 * SmartNav360 — SceneModal
 * Modal for creating a new scene.
 */

import { Modal, Form, Input, Select } from 'antd';
import { useState } from 'react';

export default function SceneModal({ open, onClose, onSubmit, projectId, assets = [] }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
///////////////////////////////
  const handleSubmit = async () => {
  try {
    const values = await form.validateFields();

    console.log("FORM VALUES:", values);

    setLoading(true);

    await onSubmit({
      ...values,
      projectId,
    });

    form.resetFields();
    onClose();
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
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="name"
          label="Scene Name"
          rules={[
            { required: true, message: 'Please enter a scene name' },
          ]}
        >
          <Input placeholder="e.g. Main Entrance, Reception Hall" />
        </Form.Item>

        <Form.Item
  name="image"
  label="Panorama Image"
  extra="Select a previously uploaded 360° image"
>
  <Select
    placeholder="Select an image"
    allowClear
    showSearch
    optionFilterProp="label"
    options={assets.map((asset) => ({
      value: asset.path || asset.filename,
      label: asset.originalName || asset.filename || asset.path,
    }))}
  />
</Form.Item>
      </Form>
    </Modal>
  );
}
