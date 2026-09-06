/**
 * SmartNav360 — ProjectModal
 * Modal for creating a new project.
 */

import { Modal, Form, Input } from 'antd';
import { useState } from 'react';

const { TextArea } = Input;

export default function ProjectModal({ open, onClose, onSubmit }) {
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

  return (
    <Modal
      title="Create Project"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="Create Project"
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
          label="Project Name"
          rules={[
            { required: true, message: 'Please enter a project name' },
            { min: 2, message: 'Name must be at least 2 characters' },
          ]}
        >
          <Input placeholder="e.g. City Hospital, Corporate HQ, Museum" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
        >
          <TextArea
            rows={3}
            placeholder="Brief description of this project"
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
