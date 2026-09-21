/**
 * SmartNav360 — 404 Not Found Page
 */

import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { HomeOutlined, CompassOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './NotFound.css';

export default function NotFound() {
  useDocumentTitle('Page Not Found');
  const navigate = useNavigate();

  return (
    <div className="not-found">
      <span className="not-found__code">404</span>
      <span className="not-found__mark"><CompassOutlined /></span>
      <h1 className="not-found__title">Page Not Found</h1>
      <p className="not-found__subtitle">The page you are looking for does not exist or has been moved.</p>
      <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
        Return Home
      </Button>
    </div>
  );
}
