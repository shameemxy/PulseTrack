import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Target, MapPin, Battery, Navigation, BrainCircuit, Play, Clock, Wifi, Camera } from 'lucide-react';

// Default Victim Icon (Red)
const victimIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

// Rescuer Icon (Blue)
const rescuerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

export default function RescueTeam() {
  const [targets, setTargets] = useState([]);
  const [rescuerLocation, setRescuerLocation] = useState(null);

  useEffect(() => {
    // 1. Pull live trapped victims and their AI triage from Firebase
    const q = query(collection(db, "victims"), where("status", "==", "TRAPPED"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeTargets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.timestamp - a.timestamp);
      setTargets(activeTargets);
    });

    // 2. Track the Ground Rescuer's LIVE location
    const geoId = navigator.geolocation.watchPosition(
      (pos) => setRescuerLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => console.warn("Rescue GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    return () => {
      unsubscribe();
      navigator.geolocation.clearWatch(geoId);
    };
  }, []);

  return (
    <div className="min-h-screen bg-black p-6 font-sans flex flex-col">
      <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <Target className="text-blue-500" size={32} />
          <h1 className="text-2xl font-bold text-blue-500">GROUND RESCUE TERMINAL</h1>
        </div>
        <div className="text-emerald-500 font-mono text-sm border border-emerald-500 px-3 py-1 rounded">
          {targets.length} ACTIVE EXTRACTIONS
        </div>
      </div>
      
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* TARGET LIST WITH AI CONTEXT */}
        <div className="flex flex-col gap-4 overflow-y-auto h-[700px] pr-2">
          {targets.map(target => (
            <div key={target.id} className="bg-white/5 border border-blue-500/30 rounded-xl p-4 flex flex-col gap-3">
              
              <div className="flex justify-between items-start">
                <div>
                    <span className="font-bold text-white text-lg">{target.victimName || target.id}</span>
                    <div className="text-gray-400 text-[10px] flex items-center gap-1 mt-1 font-mono">
                        <Clock size={10}/> {new Date(target.timestamp).toLocaleTimeString()}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs font-mono">
                    <span className="text-emerald-400 flex items-center gap-1"><Battery size={12}/>{target.battery || "--"}%</span>
                    <span className="text-blue-400 flex items-center gap-1"><Wifi size={12}/>{target.packetType || "HIGH"}</span>
                </div>
              </div>

              {/* AI TRIAGE BLOCK */}
              <div className="bg-black/50 p-3 rounded-lg border border-cyan-500/30">
                  <div className="text-[10px] text-cyan-400 font-bold mb-1 flex items-center gap-1"><BrainCircuit size={12}/> CCAI ASSESSMENT</div>
                  <p className={`text-sm whitespace-pre-line ${target.aiTriage === 'Pending...' ? 'text-gray-500 italic animate-pulse' : 'text-white'}`}>
                      {target.aiTriage}
                  </p>
              </div>

              {/* MEDIA BLOCK (AUDIO/PHOTO) */}
              <div className="flex flex-col gap-2">
                {target.audioRecordBase64 && (
                    <div>
                        <span className="text-[10px] text-blue-400 font-bold block mb-1 flex items-center gap-1"><Play size={10}/> AUDIO</span>
                        <audio controls src={target.audioRecordBase64} className="w-full h-8 rounded bg-gray-800" />
                    </div>
                )}
                {target.photoBase64 && (
                    <div>
                        <span className="text-[10px] text-gray-400 font-bold block mb-1 flex items-center gap-1"><Camera size={10}/> PHOTO</span>
                        <img src={target.photoBase64} alt="incident" className="w-full h-24 object-cover rounded-md border border-white/10" />
                    </div>
                )}
              </div>

              {/* ROUTING CONTROLS */}
              <div className="text-xs font-mono text-gray-400 flex flex-col gap-1 border-t border-white/10 pt-3">
                <span className="flex items-center gap-1"><MapPin size={12}/> {target.lat?.toFixed(5)}, {target.lng?.toFixed(5)}</span>
              </div>
              <a 
                href={`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`} 
                target="_blank" rel="noreferrer"
                className="block text-center w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-3 rounded transition flex justify-center items-center gap-2"
              >
                <Navigation size={14}/> EXTERNAL ROUTING
              </a>
            </div>
          ))}
        </div>

        {/* MASTER MAP */}
        <div className="lg:col-span-3 rounded-3xl overflow-hidden border border-white/10 h-[700px] z-0">
          <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            
            {/* Render Victims */}
            {targets.map((user) => (
              user.lat && user.lng ? (
                <Marker key={user.id} position={[user.lat, user.lng]} icon={victimIcon}>
                  <Popup>
                    <b>{user.victimName || user.id}</b><br/>
                    {user.aiTriage !== "Pending..." ? user.aiTriage.split('\n')[1] : "Needs Extraction"}
                  </Popup>
                </Marker>
              ) : null
            ))}

            {/* Render LIVE Rescuer Position */}
            {rescuerLocation && (
              <Marker position={[rescuerLocation.lat, rescuerLocation.lng]} icon={rescuerIcon}>
                <Popup><b>YOUR LOCATION</b><br/>Ground Team Alpha.</Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}