/**
 * SmartNav360 — Login Page
 * Professional login page with placeholder authentication.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Checkbox, Divider } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { MESSAGES } from '../../constants/messages';
import './Login.css';

export default function Login() {
  useDocumentTitle('Sign In');

  const navigate = useNavigate();
  const { login } = useAuth();
  const { success, error } = useNotification();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const result = await login(values);
      if (result.success) {
        success(MESSAGES.LOGIN_SUCCESS);
        navigate('/');
      } else {
        error(MESSAGES.LOGIN_ERROR);
      }
    } catch {
      error(MESSAGES.LOGIN_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login__brand">
        <div className="login__logo">
          <span>◇</span>
        </div>
        <h1 className="login__title">SmartNav360</h1>
        <p className="login__subtitle">Sign in to your account</p>
      </div>

      <Card className="login__card">
        <Form
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          initialValues={{ remember: true }}
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

          <div className="login__options">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>Remember me</Checkbox>
            </Form.Item>
            <a href="#" className="login__forgot">Forgot password?</a>
          </div>

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
          <span className="login__divider-text">Authentication backend pending</span>
        </Divider>

        <p className="login__note">
          Authentication is not yet connected to the backend. Any valid email and password will work for now.
        </p>
      </Card>
    </div>
  );
}
