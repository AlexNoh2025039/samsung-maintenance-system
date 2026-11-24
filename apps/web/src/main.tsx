import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { AppShell, LoginPage, ProtectedRoute, RoleRoute } from './components';
import {
  AdminAuditPage,
  AdminSessionsPage,
  AdminUsersPage,
  DashboardPage,
  DevicesPage,
  StationsPage,
} from './pages';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="stations" element={<StationsPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route
                path="admin/users"
                element={
                  <RoleRoute roles={['ADMIN']}>
                    <AdminUsersPage />
                  </RoleRoute>
                }
              />
              <Route
                path="admin/sessions"
                element={
                  <RoleRoute roles={['ADMIN']}>
                    <AdminSessionsPage />
                  </RoleRoute>
                }
              />
              <Route
                path="admin/audit"
                element={
                  <RoleRoute roles={['ADMIN']}>
                    <AdminAuditPage />
                  </RoleRoute>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
