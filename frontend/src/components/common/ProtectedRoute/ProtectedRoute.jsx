/**
 * SmartNav360 — ProtectedRoute
 * Gates the workspace behind a signed-in session.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import LoadingSpinner from '../LoadingSpinner';

export default function ProtectedRoute({ children, allowShareLink = false }) {
  const { isAuthenticated, initializing } = useAuth();
  const location = useLocation();

  // A published tour is opened with ?share=<token>, which is its own read-only
  // credential. Those visitors are deliberately anonymous.
  const hasShareToken = allowShareLink && new URLSearchParams(location.search).has('share');
  if (hasShareToken) return children;

  // A stored session is still being validated; redirecting now would sign out
  // a returning user on every reload.
  if (initializing) return <LoadingSpinner message="Restoring your session…" />;

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return children;
}
