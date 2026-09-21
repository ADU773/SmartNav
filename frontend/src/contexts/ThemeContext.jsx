/**
 * SmartNav360 — Theme Context
 * Manages light/dark theme with localStorage persistence.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'smartnav360_theme';

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  const value = {
    isDark,
    toggleTheme,
    theme: isDark ? 'dark' : 'light',
  };

  const antdThemeConfig = {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // Kept in sync with --color-primary in styles/variables.css for each theme.
      colorPrimary: isDark ? '#fafafa' : '#171717',
      colorTextLightSolid: isDark ? '#171717' : '#ffffff',
      colorLink: isDark ? '#fafafa' : '#171717',
      colorLinkHover: isDark ? '#ffffff' : '#000000',
      colorLinkActive: isDark ? '#ffffff' : '#000000',
      borderRadius: 6,
      fontFamily:
        "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      fontSize: 14,
      colorBgContainer: isDark ? '#171717' : '#ffffff',
      colorBgLayout: isDark ? '#0a0a0a' : '#fafafa',
      colorBorder: isDark ? '#333333' : '#ebebeb',
      colorText: isDark ? '#fafafa' : '#171717',
      colorTextSecondary: isDark ? '#a8a8a8' : '#4d4d4d',
    },
  };

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={antdThemeConfig}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

/**
 * @returns {{ isDark: boolean, toggleTheme: function, theme: string }}
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
