import { BrowserRouter, Routes, Route } from 'react-router-dom';
import VictimUI from './pages/VictimUI';
import CommandCenter from './pages/CommandCenter';
import RescueTeam from './pages/RescueTeam';
import SafeUI from './pages/SafeUI';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<VictimUI />} />
        
        {/* Command Center Routes */}
        <Route path="/command-center" element={<CommandCenter />} />
        <Route path="/CommandCentre" element={<CommandCenter />} />
        
        {/* Rescue Team Route */}
        <Route path="/rescue" element={<RescueTeam />} />
        
        {/* Safe Citizen Route */}
        <Route path="/safe" element={<SafeUI />} />
      </Routes>
    </BrowserRouter>
  );
}