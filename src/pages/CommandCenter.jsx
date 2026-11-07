import { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { 
  Wifi, Battery, Clock, X, AlertTriangle, Send, Activity, 
  ShieldAlert, MessageSquare, CheckCircle, Clock3, MapPin, 
  Mic, Map as MapIcon, List, LayoutDashboard
} from 'lucide-react';

// Bypass Leaflet tracking prevention blockers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const emergencySafetySettings = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }
];

export default function CommandCenter() {
  const [victims, setVictims] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  
  // Mobile Tab State: 'map', 'feed', 'chat'
  const [activeTab, setActiveTab] = useState('map');
  
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState([
    { role: 'ai', content: 'CCAI Online. Monitoring live telemetry. How can I assist the rescue coordination?' }
  ]);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatLog, activeTab]);

  const analyzeWithGemini = async (user) => {
    if (user.aiTriage !== "Pending...") return;
    try {
      const prompt = `Disaster Command Center AI. Telemetry: Transcript: "${user.transcript || 'None'}", Motion: ${user.motionMS2 || 0}m/s2, Audio: ${user.audioDB || 0}dB.
      1. If image provided, describe it. 
      2. Respond in 2 lines: Line 1: Assessment. Line 2: "[PRIORITY: X/10]"`;

      const parts = [{ text: prompt }];
      if (user.photoBase64 && user.photoBase64.includes(",")) {
        const base64Data = user.photoBase64.split(",")[1];
        if (base64Data && base64Data.length > 50) parts.push({ inline_data: { mime_type: "image/jpeg", data: base64Data } });
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], safetySettings: emergencySafetySettings })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Assessment unavailable.";
      await updateDoc(doc(db, "victims", user.id), { aiTriage: text });
    } catch (error) {
      await updateDoc(doc(db, "victims", user.id), { aiTriage: "AI Offline: Manual review required.\n[PRIORITY: 8/10]" });
    }
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "victims"), (snapshot) => {
      const activeUsers = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(v => v.status === "TRAPPED" || v.status === "RESCUED_PENDING")
        .sort((a,b) => b.timestamp - a.timestamp);
      
      setVictims(activeUsers);
      activeUsers.forEach(user => { if (user.status === "TRAPPED" && user.aiTriage === "Pending...") analyzeWithGemini(user); });
    });
    return () => unsubscribe();
  }, []);

  const handleConfirmResolution = async (id) => {
    try {
      await updateDoc(doc(db, "victims", id), { status: "RESOLVED" });
    } catch (err) {
      console.error("Failed to resolve incident:", err);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userQuery = chatInput;
    setChatInput("");
    setChatLog(prev => [...prev, { role: 'user', content: userQuery }]);

    const dbContext = victims.map(v => `ID: ${v.victimName}, Status: ${v.status}, Priority: ${v.aiTriage || 'Unknown'}, Audio: ${v.audioDB || 0}dB`).join(' | ');
    const prompt = `You are CCAI, an elite military-professional Command Center AI assistant for disaster management. Answer the commander's question accurately based on this live telemetry data: [${dbContext}]. Question: ${userQuery}. Keep it brief, factual, and tactical.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                safetySettings: emergencySafetySettings 
            })
        });

        const data = await response.json();
        if (data.error) {
            setChatLog(prev => [...prev, { role: 'ai', content: `API Error: ${data.error.message}` }]);
            return;
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        setChatLog(prev => [...prev, { role: 'ai', content: text }]);
    } catch (err) {
        setChatLog(prev => [...prev, { role: 'ai', content: `Network Connection Error: ${err.message}` }]);
    }
  };

  const avgAudio = victims.length ? Math.round(victims.reduce((acc, v) => acc + (Number(v.audioDB) || 0), 0) / victims.length) : 0;
  const avgMotion = victims.length ? (victims.reduce((acc, v) => acc + (Number(v.motionMS2) || 0), 0) / victims.length).toFixed(1) : 0;
  const criticalCount = victims.filter(v => (v.aiTriage || "").includes("[PRIORITY: 9") || (v.aiTriage || "").includes("[PRIORITY: 10")).length;

  // Render Helper for Victim Cards (Reused in Desktop & Mobile)
  const renderAlertCard = (user) => {
    const isPending = user.status === "RESCUED_PENDING";
    return (
      <div key={user.id} className={`bg-white p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border flex flex-col gap-3 relative overflow-hidden flex-none ${isPending ? 'border-amber-200' : 'border-black/[0.06]'}`}>
          <div className={`absolute top-0 left-0 w-1.5 h-full ${isPending ? 'bg-amber-500' : 'bg-red-500'}`}></div>
          
          <div className="flex justify-between items-start border-b border-black/[0.04] pb-3 pl-2">
              <div>
                  <h3 className="font-semibold text-sm text-[#171717]">{user.victimName || user.id}</h3>
                  <div className="text-[#737373] text-[11px] flex items-center gap-2 font-medium mt-1">
                      <span className="flex items-center gap-1"><Clock size={12}/> {user.timestamp ? new Date(user.timestamp).toLocaleTimeString() : "Unknown"}</span>
                      {user.battery && <span className="flex items-center gap-1 text-emerald-600"><Battery size={12}/> {user.battery}%</span>}
                  </div>
              </div>
              <div>
                  {isPending ? (
                      <span className="bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md flex items-center gap-1">
                          <Clock3 size={12}/> Pending
                      </span>
                  ) : (
                      <span className="bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md flex items-center gap-1">
                          <AlertTriangle size={12}/> Trapped
                      </span>
                  )}
              </div>
          </div>

          <div className="pl-2 flex flex-col gap-2 mt-1">
              {user.lat && user.lng && (
                  <div className="text-[11px] text-[#737373] flex items-center gap-1.5 font-medium">
                      <MapPin size={12} className="text-red-500"/> {user.lat.toFixed(5)}, {user.lng.toFixed(5)}
                  </div>
              )}
              {user.transcript && user.transcript.trim() !== "No words captured." && (
                  <div className="text-[12px] text-[#171717] bg-[#F5F5F5] p-2.5 rounded-xl border border-black/[0.04] flex gap-2 leading-relaxed">
                      <Mic size={14} className="text-[#737373] flex-shrink-0 mt-0.5"/> 
                      <span>"{user.transcript}"</span>
                  </div>
              )}
          </div>
          
          <div className="grid grid-cols-2 gap-3 pl-2 mt-1">
              <div className="bg-[#FAFAFA] p-3 rounded-2xl border border-black/[0.04]">
                  <div className="text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Motion Peak</div>
                  <div className="text-lg font-semibold text-[#171717] tabular-nums">{user.motionMS2 || 0} <span className="text-[10px] text-[#737373]">m/s²</span></div>
              </div>
              <div className="bg-[#FAFAFA] p-3 rounded-2xl border border-black/[0.04]">
                  <div className="text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Audio Peak</div>
                  <div className="text-lg font-semibold text-[#171717] tabular-nums">{user.audioDB || 0} <span className="text-[10px] text-[#737373]">dB</span></div>
              </div>
          </div>

          {(user.photoBase64 || user.audioRecordBase64) && (
              <div className="pl-2 flex gap-3 items-center mt-2">
                  {user.photoBase64 && (
                      <div className="cursor-pointer relative w-14 h-14 flex-shrink-0 group rounded-[14px] border border-black/[0.06] shadow-sm overflow-hidden" onClick={() => setSelectedImage(user.photoBase64)}>
                          <img src={user.photoBase64} alt="img" className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                      </div>
                  )}
                  {user.audioRecordBase64 && (
                      <audio controls src={user.audioRecordBase64} className="w-full h-10 flex-1 outline-none" />
                  )}
              </div>
          )}

          <div className="bg-[#171717] p-3.5 rounded-[16px] text-white ml-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] mt-2">
              <p className="text-[13px] font-medium leading-relaxed opacity-90">
                  {user.aiTriage || "Assessment Pending..."}
              </p>
          </div>

          {isPending && (
              <div className="ml-2 mt-2 pt-1">
                  <button 
                      onClick={() => handleConfirmResolution(user.id)}
                      className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[13px] font-semibold py-3.5 px-4 rounded-[16px] transition-colors flex items-center justify-center gap-2"
                  >
                      <CheckCircle size={16}/> Confirm Resolution
                  </button>
              </div>
          )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-['Inter',sans-serif] antialiased text-[#171717] flex flex-col h-screen overflow-hidden">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
      
      {/* Image Lightbox */}
      {selectedImage && (
        <div className="fixed inset-0 z-[999] bg-[#000000]/60 backdrop-blur-md flex items-center justify-center p-6 transition-opacity" onClick={() => setSelectedImage(null)}>
            <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                <button onClick={() => setSelectedImage(null)} className="absolute -top-12 right-0 text-white/80 hover:text-white transition-colors bg-white/10 p-2 rounded-full backdrop-blur-sm"><X size={24}/></button>
                <img src={selectedImage} alt="Incident Zoom" className="w-full h-auto rounded-[24px] shadow-2xl object-contain max-h-[80vh] border border-white/10" />
            </div>
        </div>
      )}

      {/* 
        ========================================================================
        DESKTOP LAYOUT (Hidden on Mobile)
        ========================================================================
      */}
      <div className="hidden md:flex flex-1 w-full h-full p-6 gap-6">
        
        {/* Pane 1: Global Metrics Sidebar */}
        <div className="w-1/4 min-w-[280px] max-w-[340px] flex flex-col gap-6">
            <div className="bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] p-6 flex flex-col gap-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#171717] rounded-xl flex items-center justify-center shadow-sm">
                        <Activity size={20} className="text-white" strokeWidth={2}/>
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold tracking-tight text-[#171717]">PulseTrack</h1>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#737373]">Command Center</p>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl font-semibold flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2"><AlertTriangle size={16}/> Active Incidents</span>
                        <span className="text-lg tabular-nums tracking-tighter">{victims.length}</span>
                    </div>
                    <div className="bg-blue-50 text-blue-700 px-4 py-3 rounded-2xl font-semibold flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2"><ShieldAlert size={16}/> Critical Priority</span>
                        <span className="text-lg tabular-nums tracking-tighter">{criticalCount}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] p-6 flex flex-col">
                <h2 className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Activity size={14}/> Network Telemetry
                </h2>
                <div className="flex flex-col gap-6 flex-1 justify-center">
                    <div className="text-center">
                        <span className="block text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Avg Audio Volume</span>
                        <span className="text-5xl font-semibold text-[#171717] tracking-tighter tabular-nums">{avgAudio} <span className="text-lg text-[#737373] font-medium">dB</span></span>
                    </div>
                    <div className="text-center">
                        <span className="block text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Avg Seismic Motion</span>
                        <span className="text-5xl font-semibold text-[#171717] tracking-tighter tabular-nums">{avgMotion} <span className="text-lg text-[#737373] font-medium">m/s²</span></span>
                    </div>
                </div>
                <div className="mt-auto bg-[#FAFAFA] p-4 rounded-2xl border border-black/[0.04] flex items-center gap-3">
                    <Wifi size={18} className="text-emerald-500"/> 
                    <div>
                        <div className="text-sm font-semibold text-[#171717]">System Nominal</div>
                        <div className="text-[11px] font-medium text-[#737373]">Live sync active</div>
                    </div>
                </div>
            </div>
        </div>

        {/* Pane 2: Tactical Map & AI Chat */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
            <div className="flex-1 bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] relative overflow-hidden z-0">
                <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {victims.map((user) => (
                        user.lat && user.lng ? (
                            <Marker key={user.id} position={[user.lat, user.lng]}>
                                <Popup className="font-sans">
                                    <b className="text-red-600 text-sm block mb-1">{user.victimName || user.id}</b>
                                    <span className="text-[#737373] text-[11px] font-semibold uppercase tracking-widest">Status: {user.status}</span>
                                </Popup>
                            </Marker>
                        ) : null
                    ))}
                </MapContainer>
            </div>

            <div className="h-72 bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-black/[0.04] flex items-center gap-2">
                    <MessageSquare size={16} className="text-[#171717]"/>
                    <span className="text-[11px] font-semibold text-[#171717] uppercase tracking-widest">CCAI Copilot</span>
                </div>
                <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4 bg-[#FAFAFA]">
                    {chatLog.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`px-4 py-3 rounded-[16px] max-w-[85%] text-[13px] font-medium leading-relaxed ${msg.role === 'user' ? 'bg-[#171717] text-white' : 'bg-white border border-black/[0.06] text-[#171717] shadow-sm'}`}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleChatSubmit} className="p-3 border-t border-black/[0.04] bg-white flex gap-2">
                    <input 
                        type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                        placeholder="Ask CCAI about live conditions..." 
                        className="flex-1 px-4 py-2.5 bg-[#F5F5F5] border border-transparent rounded-[14px] text-sm outline-none focus:bg-white focus:border-[#171717] focus:ring-1 focus:ring-[#171717] transition-all"
                    />
                    <button type="submit" className="bg-[#171717] hover:bg-black text-white px-4 rounded-[14px] shadow-sm transition-colors flex items-center justify-center">
                        <Send size={16} />
                    </button>
                </form>
            </div>
        </div>

        {/* Pane 3: Live Alert Feed */}
        <div className="w-[340px] bg-[#F5F5F5] rounded-[24px] border border-black/[0.04] flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-black/[0.04] flex items-center gap-2 bg-white shadow-sm z-10">
                <ShieldAlert size={16} className="text-red-600"/>
                <span className="text-[11px] font-semibold text-[#171717] uppercase tracking-widest">Live Alert Packets</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {victims.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 opacity-60">
                        <CheckCircle size={40} className="text-[#737373] mb-4 stroke-1"/>
                        <p className="text-sm font-medium text-[#737373]">Zero Active Incidents<br/>Systems Nominal</p>
                    </div>
                ) : (
                    victims.map(renderAlertCard)
                )}
            </div>
        </div>

      </div>

      {/* 
        ========================================================================
        MOBILE LAYOUT (Hidden on Desktop)
        ========================================================================
      */}
      <div className="flex md:hidden flex-col h-full w-full relative pb-24 bg-[#FAFAFA]">
          
          {/* Header Mobile */}
          <div className="px-5 py-4 bg-white/80 backdrop-blur-md border-b border-black/[0.04] flex items-center justify-between sticky top-0 z-50">
              <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#171717] rounded-lg flex items-center justify-center">
                      <Activity size={16} className="text-white" strokeWidth={2}/>
                  </div>
                  <h1 className="text-base font-semibold tracking-tight text-[#171717]">Command Center</h1>
              </div>
              {victims.length > 0 && (
                  <span className="bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md flex items-center gap-1">
                      {victims.length} Active
                  </span>
              )}
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-hidden relative">
              
              {/* TAB 1: MAP & METRICS */}
              <div className={`absolute inset-0 flex flex-col p-4 gap-4 transition-opacity duration-300 ${activeTab === 'map' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                  {/* Map */}
                  <div className="flex-1 bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] relative overflow-hidden">
                      <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          {victims.map((user) => (
                              user.lat && user.lng ? (
                                  <Marker key={user.id} position={[user.lat, user.lng]}>
                                      <Popup><b className="font-sans text-sm">{user.victimName || user.id}</b></Popup>
                                  </Marker>
                              ) : null
                          ))}
                      </MapContainer>
                  </div>
                  {/* Mini Metrics */}
                  <div className="bg-white p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex justify-around">
                      <div className="text-center">
                          <span className="block text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Avg Motion</span>
                          <span className="text-2xl font-semibold text-[#171717] tabular-nums">{avgMotion} <span className="text-xs text-[#737373]">m/s²</span></span>
                      </div>
                      <div className="w-[1px] bg-black/[0.06]"></div>
                      <div className="text-center">
                          <span className="block text-[10px] font-semibold text-[#737373] uppercase tracking-widest mb-1">Avg Audio</span>
                          <span className="text-2xl font-semibold text-[#171717] tabular-nums">{avgAudio} <span className="text-xs text-[#737373]">dB</span></span>
                      </div>
                  </div>
              </div>

              {/* TAB 2: LIVE FEED */}
              <div className={`absolute inset-0 overflow-y-auto p-4 transition-opacity duration-300 ${activeTab === 'feed' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                  <div className="flex flex-col gap-4 pb-10">
                      {victims.length === 0 ? (
                          <div className="mt-20 flex flex-col items-center text-center opacity-60">
                              <CheckCircle size={48} className="text-[#737373] mb-4 stroke-1"/>
                              <p className="text-base font-medium text-[#737373]">Zero Active Incidents</p>
                          </div>
                      ) : (
                          victims.map(renderAlertCard)
                      )}
                  </div>
              </div>

              {/* TAB 3: AI CHAT */}
              <div className={`absolute inset-0 flex flex-col bg-white transition-opacity duration-300 ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                  <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-4 bg-[#FAFAFA] pb-10">
                      {chatLog.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                              <div className={`px-4 py-3 rounded-[16px] max-w-[85%] text-[13px] font-medium leading-relaxed ${msg.role === 'user' ? 'bg-[#171717] text-white' : 'bg-white border border-black/[0.06] text-[#171717] shadow-sm'}`}>
                                  {msg.content}
                              </div>
                          </div>
                      ))}
                      <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleChatSubmit} className="p-4 border-t border-black/[0.04] bg-white flex gap-2">
                      <input 
                          type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                          placeholder="Ask CCAI..." 
                          className="flex-1 px-4 py-3 bg-[#F5F5F5] border border-transparent rounded-[16px] text-sm outline-none focus:bg-white focus:border-[#171717] focus:ring-1 focus:ring-[#171717] transition-all"
                      />
                      <button type="submit" className="bg-[#171717] hover:bg-black text-white px-5 rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-colors flex items-center justify-center">
                          <Send size={18} />
                      </button>
                  </form>
              </div>

          </div>

          {/* Floating Mobile Tab Bar */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#171717] p-1.5 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.25)] flex items-center gap-1 z-50">
              <button 
                  onClick={() => setActiveTab('map')} 
                  className={`flex flex-col items-center gap-1 w-20 py-2.5 rounded-full transition-all ${activeTab === 'map' ? 'bg-white/10 text-white' : 'text-[#A3A3A3] hover:text-white'}`}
              >
                  <MapIcon size={20} />
                  <span className="text-[9px] font-bold uppercase tracking-widest">Map</span>
              </button>
              <button 
                  onClick={() => setActiveTab('feed')} 
                  className={`flex flex-col items-center gap-1 w-20 py-2.5 rounded-full transition-all relative ${activeTab === 'feed' ? 'bg-white/10 text-white' : 'text-[#A3A3A3] hover:text-white'}`}
              >
                  <List size={20} />
                  <span className="text-[9px] font-bold uppercase tracking-widest">Feed</span>
                  {victims.length > 0 && <span className="absolute top-2 right-4 w-2 h-2 bg-red-500 rounded-full border border-[#171717]"></span>}
              </button>
              <button 
                  onClick={() => setActiveTab('chat')} 
                  className={`flex flex-col items-center gap-1 w-20 py-2.5 rounded-full transition-all ${activeTab === 'chat' ? 'bg-white/10 text-white' : 'text-[#A3A3A3] hover:text-white'}`}
              >
                  <MessageSquare size={20} />
                  <span className="text-[9px] font-bold uppercase tracking-widest">CCAI</span>
              </button>
          </div>
      </div>
      
    </div>
  );
}