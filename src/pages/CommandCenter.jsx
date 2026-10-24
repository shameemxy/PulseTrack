import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, ShieldAlert, Camera, BrainCircuit, Play, Wifi, Battery, MessageSquare, MapPin, Clock } from 'lucide-react';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export default function CommandCenter() {
  const [victims, setVictims] = useState([]);

const analyzeWithGemini = async (user) => {
    if (user.aiTriage !== "Pending...") return;
    
    try {
      const prompt = `You are a disaster Command Center AI evaluating a distress beacon.
      Telemetry Data:
      - Transcript: "${user.transcript || 'None'}"
      - Motion Impact: ${user.motionMS2} m/s2
      - Audio Decibels: ${user.audioDB} dB
      
      CRITICAL INSTRUCTIONS:
      1. If an image is provided, you MUST describe what you see (e.g., collapsed structure, dark environment, outdoor terrain). 
      2. If no image is provided, base your assessment solely on the transcript and telemetry.
      
      Respond STRICTLY in exactly two lines:
      Line 1: A 1-2 sentence detailed assessment of the situation combining the visual data and audio data.
      Line 2: "[PRIORITY: X/10]"`;

      const parts = [{ text: prompt }];
      
      if (user.photoBase64 && user.photoBase64.includes(",")) {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: user.photoBase64.split(",")[1] } });
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Assessment unavailable.";
      await updateDoc(doc(db, "victims", user.id), { aiTriage: text });
    } catch (error) {
      await updateDoc(doc(db, "victims", user.id), { aiTriage: "AI Offline: Review telemetry manually.\n[PRIORITY: 8/10]" });
    }
  };
  
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "victims"), (snapshot) => {
      const activeUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.timestamp - a.timestamp);
      setVictims(activeUsers);
      
      activeUsers.forEach(user => {
        if (user.status === "TRAPPED" && user.aiTriage === "Pending...") {
          analyzeWithGemini(user);
        }
      });
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-black p-6 font-sans flex flex-col">
      <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-cyan-400" size={32} />
          <h1 className="text-3xl font-bold text-cyan-400">CCAI MASTER DASHBOARD</h1>
        </div>
        <div className="text-red-500 font-mono text-sm animate-pulse border border-red-500 px-3 py-1 rounded">
          {victims.length} RECORDED INCIDENTS
        </div>
      </div>
      
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-3xl overflow-hidden border border-white/10 h-[750px] z-0">
          <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {victims.map((user) => (
              user.lat && user.lng ? (
                <Marker key={user.id} position={[user.lat, user.lng]}>
                  <Popup>
                    <b className="text-red-500">{user.victimName || user.id}</b><br/>
                    Status: {user.status}
                  </Popup>
                </Marker>
              ) : null
            ))}
          </MapContainer>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto h-[750px] pr-2">
          {victims.map((user) => (
            <div key={user.id} className="p-4 rounded-2xl border bg-red-900/20 border-red-500">
              <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-bold text-white text-lg">{user.victimName || user.id}</h3>
                    <div className="text-gray-400 text-xs flex items-center gap-1 mt-1 font-mono">
                        <Clock size={12}/> {new Date(user.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs font-mono">
                    <span className="flex items-center gap-1 text-emerald-400"><Battery size={12}/>{user.battery || "--"}%</span>
                    <span className="text-blue-400 flex items-center gap-1"><Wifi size={12}/>{user.packetType || "HIGH"}</span>
                  </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-400 mb-3 border-y border-white/10 py-2">
                  <div>LAT: {user.lat?.toFixed(5)}</div>
                  <div>LNG: {user.lng?.toFixed(5)}</div>
                  {user.motionMS2 && <div>MOT: {user.motionMS2}m/s²</div>}
                  {user.audioDB && <div>SND: {user.audioDB}dB</div>}
              </div>

              {/* INDIVIDUAL GOOGLE MAPS LINK */}
              <a 
                href={`https://www.google.com/maps/search/?api=1&query=${user.lat},${user.lng}`}
                target="_blank" rel="noreferrer"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded flex items-center justify-center gap-2 mb-3 transition"
              >
                <MapPin size={14}/> OPEN IN GOOGLE MAPS
              </a>

              {user.transcript && (
                <div className="bg-white/5 p-2 rounded text-xs text-gray-200 italic mb-2 border-l-2 border-cyan-500">
                  <MessageSquare size={12} className="inline mr-1 text-cyan-400"/> "{user.transcript}"
                </div>
              )}
              
              {/* PLAYABLE AUDIO BLOB */}
              {user.audioRecordBase64 && (
                <div className="mb-3">
                  <span className="text-[10px] text-blue-400 font-bold block mb-1 flex items-center gap-1"><Play size={10}/> RAW AUDIO CLIP</span>
                  <audio controls src={user.audioRecordBase64} className="w-full h-8 rounded bg-gray-800" />
                </div>
              )}

              {user.photoBase64 && (
                <img src={user.photoBase64} alt="incident" className="w-full h-32 object-cover rounded-md border border-red-500/30 mb-3" />
              )}

              <div className="bg-black/50 p-3 rounded-lg border border-cyan-500/30">
                  <div className="text-[10px] text-cyan-400 font-bold mb-1 flex items-center gap-1"><BrainCircuit size={12}/> CCAI ASSESSMENT</div>
                  <p className={`text-sm whitespace-pre-line ${user.aiTriage === 'Pending...' ? 'text-gray-500 italic animate-pulse' : 'text-white'}`}>
                      {user.aiTriage}
                  </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}