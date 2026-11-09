import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import VictimUI from './pages/VictimUI';
import CommandCenter from './pages/CommandCenter';
import RescueTeam from './pages/RescueTeam';
import SafeUI from './pages/SafeUI';
import Login from './pages/Login';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes — anonymous auth is handled internally by VictimUI/SafeUI */}
          <Route path="/" element={<VictimUI />} />
          <Route path="/safe" element={<SafeUI />} />

          {/* Operator login */}
          <Route path="/login" element={<Login />} />

          {/* Protected routes — require Email/Password authentication */}
          <Route path="/command-center" element={<ProtectedRoute><CommandCenter /></ProtectedRoute>} />
          <Route path="/rescue" element={<ProtectedRoute><RescueTeam /></ProtectedRoute>} />

          {/* Fallback: If a user types a wrong URL, redirect them to the home page */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}