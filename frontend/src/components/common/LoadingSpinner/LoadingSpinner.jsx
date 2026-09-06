/**
 * SmartNav360 — LoadingSpinner
 * Centered loading indicator with optional message.
 */

import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import './LoadingSpinner.css';

export default function LoadingSpinner({ message = 'Loading...', size = 'large', fullPage = false }) {
  const indicator = <LoadingOutlined style={{ fontSize: size === 'large' ? 32 : 20 }} spin />;

  return (
    <div className={`loading-spinner ${fullPage ? 'loading-spinner--full' : ''}`}>
      <Spin indicator={indicator} />
      {message && <p className="loading-spinner__message">{message}</p>}
    </div>
  );
}
