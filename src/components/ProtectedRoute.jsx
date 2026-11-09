import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { currentUser, isLoading } = useAuth();
  const location = useLocation();

  // Show nothing while Supabase resolves the initial auth state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#171717] border-t-transparent rounded-full animate-spin" />
          <span className="text-[#737373] text-sm font-medium">Authenticating...</span>
        </div>
      </div>
    );
  }

  // Redirect anonymous users and unauthenticated users to login
  const isAuthenticatedOperator = currentUser && !currentUser.isAnonymous;

  if (!isAuthenticatedOperator) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
