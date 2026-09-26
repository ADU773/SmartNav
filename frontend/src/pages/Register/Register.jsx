/**
 * SmartNav360 — Register Page
 * Creates an account against the backend's JWT auth endpoints.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Divider } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import Logo from '../../components/common/Logo';
import '../Login/Login.css';

export default function Register() {
  useDocumentTitle('Create Account');

  const navigate = useNavigate();
  const { register } = useAuth();
  const { success, error } = useNotification();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const result = await register({ name: values.name, email: values.email, password: values.password });
      if (result.success) {
        success('Account created', `Welcome, ${result.data.name}.`);
        navigate('/', { replace: true });
      } else {
        error('Could not create the account', result.message);
      }
    } catch (err) {
      error('Could not create the account', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login__brand">
        <Logo size={56} showText={false} />
        <h1 className="login__title">SmartNav360</h1>
        <p className="login__subtitle">Create your account</p>
      </div>

      <Card className="login__card">
        <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter your name' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Ada Lovelace" size="large" />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="you@example.com" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Please choose a password' },
              { min: 8, message: 'Use at least 8 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="At least 8 characters" size="large" />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="Confirm password"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Please confirm your password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('The two passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Repeat your password" size="large" />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Create account
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <span className="login__divider-text">Already registered?</span>
        </Divider>

        <p className="login__note">
          <Link to="/login">Sign in instead</Link>
        </p>
      </Card>
    </div>
  );
}
