/**
 * SmartNav360 — Notification Context
 * Provides consistent app-wide notifications using Ant Design.
 */

import { createContext, useContext, useCallback } from 'react';
import { notification } from 'antd';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [api, contextHolder] = notification.useNotification();

  const notify = useCallback(
    ({ type = 'info', message, description, duration = 4 }) => {
      api[type]({
        message,
        description,
        duration,
        placement: 'topRight',
      });
    },
    [api]
  );

  const success = useCallback(
    (message, description) => notify({ type: 'success', message, description }),
    [notify]
  );

  const error = useCallback(
    (message, description) => notify({ type: 'error', message, description }),
    [notify]
  );

  const warning = useCallback(
    (message, description) => notify({ type: 'warning', message, description }),
    [notify]
  );

  const info = useCallback(
    (message, description) => notify({ type: 'info', message, description }),
    [notify]
  );

  const value = { notify, success, error, warning, info };

  return (
    <NotificationContext.Provider value={value}>
      {contextHolder}
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * @returns {{ notify, success, error, warning, info }}
 */
export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}
