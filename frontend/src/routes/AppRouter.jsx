/**
 * SmartNav360 — Application Router
 * React Router v6 configuration with lazy-loaded pages.
 */

import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import AuthLayout from '../layouts/AuthLayout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ErrorBoundary from '../components/common/ErrorBoundary';

/* ---- Lazy-loaded pages ---- */
const ProjectSelection = lazy(() => import('../pages/ProjectSelection'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const AssetManager = lazy(() => import('../pages/AssetManager'));
const SceneBuilder = lazy(() => import('../pages/SceneBuilder'));
const HotspotBuilder = lazy(() => import('../pages/HotspotBuilder'));
const MapEditor = lazy(() => import('../pages/MapEditor'));
const VirtualExperience = lazy(() => import('../pages/VirtualExperience'));
const AIWorkspace = lazy(() => import('../pages/AIWorkspace'));
const Analytics = lazy(() => import('../pages/Analytics'));
const Deployment = lazy(() => import('../pages/Deployment'));
const Settings = lazy(() => import('../pages/Settings'));
const Login = lazy(() => import('../pages/Login'));
const NotFound = lazy(() => import('../pages/NotFound'));

function SuspenseWrapper({ children }) {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading..." />}>
      {children}
    </Suspense>
  );
}

const router = createBrowserRouter([
  /* ---- Project Selection (standalone page) ---- */
  {
    path: '/',
    errorElement: <ErrorBoundary />,
    element: (
      <SuspenseWrapper>
        <ProjectSelection />
      </SuspenseWrapper>
    ),
  },

  /* ---- Auth layout ---- */
  {
    element: (
      <SuspenseWrapper>
        <AuthLayout />
      </SuspenseWrapper>
    ),
    errorElement: <ErrorBoundary />,
    children: [
      {
        path: '/login',
        element: (
          <SuspenseWrapper>
            <Login />
          </SuspenseWrapper>
        ),
      },
    ],
  },

  /* ---- Main workspace layout ---- */
  {
    element: (
      <SuspenseWrapper>
        <MainLayout />
      </SuspenseWrapper>
    ),
    errorElement: <ErrorBoundary />,
    children: [
      {
        path: '/dashboard',
        element: (
          <SuspenseWrapper>
            <Dashboard />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/assets',
        element: (
          <SuspenseWrapper>
            <AssetManager />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/scenes',
        element: (
          <SuspenseWrapper>
            <SceneBuilder />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/hotspots',
        element: (
          <SuspenseWrapper>
            <HotspotBuilder />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/map',
        element: <SuspenseWrapper><MapEditor /></SuspenseWrapper>,
      },
      {
        path: '/experience',
        element: (
          <SuspenseWrapper>
            <VirtualExperience />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/ai',
        element: (
          <SuspenseWrapper>
            <AIWorkspace />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/analytics',
        element: (
          <SuspenseWrapper>
            <Analytics />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/deployment',
        element: (
          <SuspenseWrapper>
            <Deployment />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/settings',
        element: (
          <SuspenseWrapper>
            <Settings />
          </SuspenseWrapper>
        ),
      },
    ],
  },

  /* ---- 404 ---- */
  {
    path: '*',
    element: (
      <SuspenseWrapper>
        <NotFound />
      </SuspenseWrapper>
    ),
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
