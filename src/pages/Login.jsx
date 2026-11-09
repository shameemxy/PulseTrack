import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, ShieldAlert, AlertTriangle } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signInWithEmail, authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/command-center';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setIsLoading(true);
    const user = await signInWithEmail(email, password);
    setIsLoading(false);
    if (user) {
      navigate(from, { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center p-4 sm:p-6 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>

      <div className="w-full max-w-sm bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] p-6 sm:p-8 border border-black/[0.06] flex flex-col items-center">
        <div className="w-16 h-16 bg-[#171717] rounded-[16px] flex items-center justify-center mb-6 shadow-md">
          <Activity className="text-white" size={32} strokeWidth={2} />
        </div>

        <h1 className="text-[#171717] text-2xl font-semibold tracking-tight mb-1">PulseTrack</h1>
        <p className="text-[#737373] font-medium text-sm mb-8 text-center leading-relaxed">
          Operator access required for<br />Command Center & Rescue Terminal.
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@pulsetrack.ops"
              required
              className="w-full px-4 py-3 bg-[#F5F5F5] border border-transparent rounded-[14px] text-sm text-[#171717] outline-none focus:bg-white focus:border-[#171717] focus:ring-1 focus:ring-[#171717] transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-4 py-3 bg-[#F5F5F5] border border-transparent rounded-[14px] text-sm text-[#171717] outline-none focus:bg-white focus:border-[#171717] focus:ring-1 focus:ring-[#171717] transition-all"
            />
          </div>

          {authError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-[14px] px-4 py-3">
              <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-700 font-medium leading-relaxed">{authError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#171717] hover:bg-black text-white py-3.5 px-6 rounded-full font-medium text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all mt-2 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <ShieldAlert size={16} />
            )}
            {isLoading ? 'Authenticating...' : 'Access Command Terminal'}
          </button>
        </form>
      </div>
    </div>
  );
}
