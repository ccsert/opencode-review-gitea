import { createBrowserRouter, Navigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layouts'
import { ProtectedRoute } from '@/components/protected-route'
import {
  LoginPage,
  DashboardPage,
  RepositoriesPage,
  ReviewsPage,
  TemplatesPage,
  ApiKeysPage,
  SettingsPage,
} from '@/pages'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'repositories',
        element: <RepositoriesPage />,
      },
      {
        path: 'reviews',
        element: <ReviewsPage />,
      },
      {
        path: 'templates',
        element: <TemplatesPage />,
      },
      {
        path: 'api-keys',
        element: <ApiKeysPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])
