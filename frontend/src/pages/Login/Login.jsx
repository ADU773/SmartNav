/**
 * SmartNav360 — Login Page
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Divider } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { MESSAGES } from '../../constants/messages';
import Logo from '../../components/common/Logo';
import './Login.css';

export default function Login() {
  useDocumentTitle('Sign In');

  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { success, error } = useNotification();
  const [loading, setLoading] = useState(false);

  // ProtectedRoute records where the visitor was headed before the redirect.
  const destination = location.state?.from || '/';

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const result = await login(values);
      if (result.success) {
        success(MESSAGES.LOGIN_SUCCESS);
        navigate(destination, { replace: true });
      } else {
        error(result.message || MESSAGES.LOGIN_ERROR);
      }
    } catch (err) {
      error(err.message || MESSAGES.LOGIN_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login__brand">
        <Logo size={56} showText={false} />
        <h1 className="login__title">SmartNav360</h1>
        <p className="login__subtitle">Sign in to your account</p>
      </div>

      <Card className="login__card">
        <Form
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="admin@example.com"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="••••••••"
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <span className="login__divider-text">New here?</span>
        </Divider>

        <p className="login__note">
          <Link to="/register">Create an account</Link> — the first account registered becomes the administrator.
        </p>
      </Card>
    </div>
  );
}
