import { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { Play, Wifi, Battery, Clock, X, AlertTriangle, Send, Activity, ShieldAlert, MessageSquare, CheckCircle, Clock3, MapPin, Mic } from 'lucide-react';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
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
  
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState([
    { role: 'ai', content: 'CCAI Online. Monitoring live telemetry. How can I assist Commander?' }
  ]);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatLog]);

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

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans flex flex-col h-screen overflow-hidden text-slate-900">
      
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-slate-900/90 flex items-center justify-center p-6" onClick={() => setSelectedImage(null)}>
            <div className="relative max-w-2xl w-full">
                <button className="absolute -top-10 right-0 text-white"><X size={32}/></button>
                <img src={selectedImage} alt="Incident" className="w-full h-auto rounded-xl shadow-2xl object-contain max-h-[80vh]" />
            </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex-none">
        <div className="flex items-center gap-3">
          <img src="/logo-transparent.png" alt="Logo" className="w-7 h-7 object-contain" onError={(e) => e.target.style.display='none'} />
          <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">PulseTrack Command</h1>
        </div>
        <div className="flex gap-3">
            <div className="bg-red-50 text-red-700 px-3 py-1.5 rounded border border-red-200 font-bold flex items-center gap-2 text-xs">
                <AlertTriangle size={14}/> {victims.length} ACTIVE INCIDENTS
            </div>
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded border border-blue-200 font-bold flex items-center gap-2 text-xs">
                <ShieldAlert size={14}/> {criticalCount} CRITICAL
            </div>
        </div>
      </div>
      
      <div className="flex-1 grid grid-cols-12 gap-4 h-full min-h-0">
        
        {/* Panel 1: Metrics */}
        <div className="col-span-3 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-3 border-b border-slate-100 font-bold text-sm text-slate-700 flex items-center gap-2 bg-slate-50 flex-none">
                <Activity size={16} className="text-blue-600"/> GLOBAL METRICS
            </div>
            <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-6">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 flex flex-col gap-1 text-center shadow-sm">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Network Audio Avg</span>
                    <span className="text-5xl font-black text-slate-800 tracking-tight">{avgAudio} <span className="text-lg text-slate-400 font-medium">dB</span></span>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 flex flex-col gap-1 text-center shadow-sm">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Seismic Motion Avg</span>
                    <span className="text-5xl font-black text-slate-800 tracking-tight">{avgMotion} <span className="text-lg text-slate-400 font-medium">m/s²</span></span>
                </div>

                <div className="mt-auto flex flex-col gap-3">
                  <div className="p-4 bg-slate-800 rounded-lg text-white">
                      <span className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-widest">System Status</span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-emerald-400"><Wifi size={14} className="text-emerald-400"/> Network Stable</span>
                  </div>
                </div>
            </div>
        </div>

        {/* Panel 2: Map & Chat */}
        <div className="col-span-6 flex flex-col gap-4 min-h-0">
            <div className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm relative overflow-hidden z-0">
                <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {victims.map((user) => (
                    user.lat && user.lng ? (
                        <Marker key={user.id} position={[user.lat, user.lng]}>
                          <Popup className="font-sans">
                              <b className="text-red-600 text-sm">{user.victimName || user.id}</b><br/>
                              <span className="text-slate-500 text-xs font-medium">Status: {user.status}</span>
                          </Popup>
                        </Marker>
                    ) : null
                    ))}
                </MapContainer>
            </div>

            <div className="h-64 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden flex-none">
                <div className="p-2 border-b border-slate-100 font-bold text-sm text-slate-700 flex items-center gap-2 bg-slate-50 flex-none">
                    <MessageSquare size={16} className="text-blue-600"/> CCAI COMMAND COPILOT
                </div>
                <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3 bg-slate-50/50">
                    {chatLog.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`px-3 py-2 rounded-lg max-w-[85%] text-sm font-medium ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-800'}`}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleChatSubmit} className="p-2 border-t border-slate-200 bg-white flex gap-2 flex-none">
                    <input 
                        type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                        placeholder="Ask CCAI about live conditions..." 
                        className="flex-1 px-3 py-2 bg-slate-100 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500 transition"
                    />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md transition">
                        <Send size={16} />
                    </button>
                </form>
            </div>
        </div>

        {/* Panel 3: Feed */}
        <div className="col-span-3 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-3 border-b border-slate-100 font-bold text-sm text-slate-700 flex items-center gap-2 bg-slate-50 flex-none">
                <ShieldAlert size={16} className="text-red-600"/> LIVE ALERT PACKETS
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4 bg-slate-50">
                {victims.map((user) => {
                    const isPending = user.status === "RESCUED_PENDING";

                    return (
                        <div key={user.id} className={`bg-white p-4 rounded-xl border shadow-sm flex flex-col gap-3 relative overflow-hidden flex-none ${isPending ? 'border-amber-400 bg-amber-50/40 ring-1 ring-amber-400' : 'border-slate-200'}`}>
                            
                            <div className={`absolute top-0 left-0 w-1.5 h-full ${isPending ? 'bg-amber-500' : 'bg-red-500'}`}></div>

                            {/* Header: Name, Time, Battery, Network */}
                            <div className="flex justify-between items-start border-b border-slate-100 pb-2 pl-2">
                                <div>
                                    <h3 className="font-bold text-sm text-slate-800">{user.victimName || user.id}</h3>
                                    <div className="text-slate-500 text-[10px] flex items-center gap-2 font-mono mt-1">
                                        <span className="flex items-center gap-0.5"><Clock size={10}/> {user.timestamp ? new Date(user.timestamp).toLocaleTimeString() : "Unknown"}</span>
                                        {user.battery && <span className="flex items-center gap-0.5 text-emerald-600"><Battery size={10}/> {user.battery}%</span>}
                                        {user.packetType && <span className="flex items-center gap-0.5 text-blue-600"><Wifi size={10}/> {user.packetType === "LOW_BANDWIDTH" ? "2G" : "4G/5G"}</span>}
                                    </div>
                                </div>
                                <div>
                                    {isPending ? (
                                        <span className="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-xs">
                                            <Clock3 size={12}/> RESCUE PENDING
                                        </span>
                                    ) : (
                                        <span className="bg-red-100 text-red-800 border border-red-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                                            TRAPPED
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Location & Transcript Info */}
                            <div className="pl-2 flex flex-col gap-1.5 mt-1">
                                {user.lat && user.lng && (
                                    <div className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                                        <MapPin size={10} className="text-red-500"/> {user.lat.toFixed(5)}, {user.lng.toFixed(5)}
                                    </div>
                                )}
                                {user.transcript && user.transcript.trim() !== "No words captured." && (
                                    <div className="text-[10px] text-slate-600 italic bg-slate-100 p-1.5 rounded border border-slate-200 flex gap-1.5">
                                        <Mic size={12} className="text-blue-500 flex-shrink-0 mt-0.5"/> 
                                        <span>"{user.transcript}"</span>
                                    </div>
                                )}
                            </div>
                            
                            {/* Motion & Audio Sensor Blocks */}
                            <div className="grid grid-cols-2 gap-2 pl-2">
                                <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase">Motion</div>
                                    <div className="text-sm font-bold text-slate-700">{user.motionMS2 || 0} m/s²</div>
                                </div>
                                <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase">Audio</div>
                                    <div className="text-sm font-bold text-slate-700">{user.audioDB || 0} dB</div>
                                </div>
                            </div>

                            {/* Multimedia Render: Audio Player & Photo Thumbnail */}
                            {(user.photoBase64 || user.audioRecordBase64) && (
                                <div className="pl-2 flex gap-2 items-center mt-1">
                                    {user.photoBase64 && (
                                        <div className="cursor-pointer relative w-12 h-12 flex-shrink-0 group rounded-md border border-slate-200 shadow-xs overflow-hidden" onClick={() => setSelectedImage(user.photoBase64)}>
                                            <img src={user.photoBase64} alt="img" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                    {user.audioRecordBase64 && (
                                        <audio controls src={user.audioRecordBase64} className="w-full h-8 flex-1 outline-none" />
                                    )}
                                </div>
                            )}

                            {/* CCAI Assessment Box */}
                            <div className="bg-slate-800 p-3 rounded-lg text-white ml-2 shadow-inner mt-1">
                                <p className="text-xs font-medium leading-relaxed">
                                    {user.aiTriage || "Assessment Pending..."}
                                </p>
                            </div>

                            {/* Command Verify Button */}
                            {isPending && (
                                <div className="ml-2 mt-1 pt-1">
                                    <button 
                                        onClick={() => handleConfirmResolution(user.id)}
                                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle size={16}/> Confirm Resolution & Close Packet
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
                {victims.length === 0 && (
                    <div className="text-center text-sm text-slate-400 font-medium py-10">No active incidents.</div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
}