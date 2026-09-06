/**
 * SmartNav360 — ConfirmDialog
 * Reusable confirmation modal for destructive actions.
 */

import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

const { confirm } = Modal;

/**
 * Show a confirmation dialog.
 * @param {{ title: string, content: string, onConfirm: function, okText?: string, danger?: boolean }} options
 */
export function showConfirmDialog({
  title = 'Are you sure?',
  content = 'This action cannot be undone.',
  onConfirm,
  onCancel,
  okText = 'Confirm',
  cancelText = 'Cancel',
  danger = true,
}) {
  confirm({
    title,
    icon: <ExclamationCircleOutlined />,
    content,
    okText,
    cancelText,
    okButtonProps: { danger },
    onOk: onConfirm,
    onCancel,
    centered: true,
  });
}
