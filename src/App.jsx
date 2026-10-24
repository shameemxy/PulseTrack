import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import VictimUI from './pages/VictimUI';
import CommandCenter from './pages/CommandCenter';
import RescueTeam from './pages/RescueTeam';
import SafeUI from './pages/SafeUI';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<VictimUI />} />
        <Route path="/command-center" element={<CommandCenter />} />
        <Route path="/rescue" element={<RescueTeam />} />
        <Route path="/safe" element={<SafeUI />} />
        
        {/* Fallback: If a user types a wrong URL, redirect them to the home page */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}