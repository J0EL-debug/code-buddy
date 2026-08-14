import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/components/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import ProjectsPage from '@/pages/ProjectsPage';
import ReviewsPage from '@/pages/ReviewsPage';
import DevelopersPage from '@/pages/DevelopersPage';
import ReviewCodePage from '@/pages/ReviewCodePage';

function App() {
  return (
    <ErrorBoundary fullPage>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="review" element={<ReviewCodePage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="reviews" element={<ReviewsPage />} />
              <Route path="developers" element={<DevelopersPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App
