/**
 * SmartNav360 — Application Router
 * React Router v6 configuration with lazy-loaded pages.
 */

import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import AuthLayout from '../layouts/AuthLayout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ErrorBoundary from '../components/common/ErrorBoundary';
import ProtectedRoute from '../components/common/ProtectedRoute';

/* ---- Lazy-loaded pages ---- */
const ProjectSelection = lazy(() => import('../pages/ProjectSelection'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const AssetManager = lazy(() => import('../pages/AssetManager'));
const SceneBuilder = lazy(() => import('../pages/SceneBuilder'));
const HotspotBuilder = lazy(() => import('../pages/HotspotBuilder'));
const MapEditor = lazy(() => import('../pages/MapEditor'));
const FloorPlan = lazy(() => import('../pages/FloorPlan'));
const PanoramicViewer = lazy(() => import('../pages/PanoramicViewer'));
const PanoramaCapture = lazy(() => import('../pages/PanoramaCapture'));
const VirtualExperience = lazy(() => import('../pages/VirtualExperience'));
const AIWorkspace = lazy(() => import('../pages/AIWorkspace'));
const Analytics = lazy(() => import('../pages/Analytics'));
const Deployment = lazy(() => import('../pages/Deployment'));
const Settings = lazy(() => import('../pages/Settings'));
const Login = lazy(() => import('../pages/Login'));
const Register = lazy(() => import('../pages/Register'));
const NotFound = lazy(() => import('../pages/NotFound'));

function SuspenseWrapper({ children }) {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading..." />}>
      {children}
    </Suspense>
  );
}

// Every workspace page needs both the lazy boundary and the auth gate, so they
// are applied together rather than nested by hand at each route.
function Guarded({ children, allowShareLink = false }) {
  return (
    <ProtectedRoute allowShareLink={allowShareLink}>
      <SuspenseWrapper>{children}</SuspenseWrapper>
    </ProtectedRoute>
  );
}

const router = createBrowserRouter([
  /* ---- Project Selection (standalone page) ---- */
  {
    path: '/',
    errorElement: <ErrorBoundary />,
    element: (
      <Guarded>
        <ProjectSelection />
      </Guarded>
    ),
  },

  /* ---- Panorama capture (standalone, phone-facing, no sidebar) ---- */
  {
    path: '/panorama-capture/:token',
    errorElement: <ErrorBoundary />,
    element: (
      <SuspenseWrapper>
        <PanoramaCapture />
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
      {
        path: '/register',
        element: (
          <SuspenseWrapper>
            <Register />
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
          <Guarded>
            <Dashboard />
          </Guarded>
        ),
      },
      {
        path: '/assets',
        element: (
          <Guarded>
            <AssetManager />
          </Guarded>
        ),
      },
      {
        path: '/scenes',
        element: (
          <Guarded>
            <SceneBuilder />
          </Guarded>
        ),
      },
      {
        path: '/hotspots',
        element: (
          <Guarded>
            <HotspotBuilder />
          </Guarded>
        ),
      },
      {
        path: '/map',
        element: <Guarded><MapEditor /></Guarded>,
      },
      {
        path: '/floor-plan',
        element: <Guarded><FloorPlan /></Guarded>,
      },
      {
        path: '/panorama',
        element: <Guarded><PanoramicViewer /></Guarded>,
      },
      {
        path: '/experience',
        element: (
          <Guarded allowShareLink>
            <VirtualExperience />
          </Guarded>
        ),
      },
      {
        path: '/ai',
        element: (
          <Guarded>
            <AIWorkspace />
          </Guarded>
        ),
      },
      {
        path: '/analytics',
        element: (
          <Guarded>
            <Analytics />
          </Guarded>
        ),
      },
      {
        path: '/deployment',
        element: (
          <Guarded>
            <Deployment />
          </Guarded>
        ),
      },
      {
        path: '/settings',
        element: (
          <Guarded>
            <Settings />
          </Guarded>
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
