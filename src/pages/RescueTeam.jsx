import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Target, MapPin, Battery, Navigation, Play, Clock, Wifi, Camera, MessageSquare, CheckCircle2, Clock3 } from 'lucide-react';

const victimIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

const rescuerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

export default function RescueTeam() {
  const [targets, setTargets] = useState([]);
  const [rescuerLocation, setRescuerLocation] = useState(null);

  useEffect(() => {
    // Pull active incidents (TRAPPED or RESCUED_PENDING)
    const q = query(collection(db, "victims"), where("status", "in", ["TRAPPED", "RESCUED_PENDING"]));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeTargets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.timestamp - a.timestamp);
      setTargets(activeTargets);
    });

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

  // Update status to RESCUED_PENDING
  const handleMarkRescued = async (id) => {
    try {
      await updateDoc(doc(db, "victims", id), { status: "RESCUED_PENDING" });
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  // Update status back to TRAPPED / In Progress
  const handleMarkInProgress = async (id) => {
    try {
      await updateDoc(doc(db, "victims", id), { status: "TRAPPED" });
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  return (
    <div className="h-screen bg-slate-50 p-4 font-sans text-slate-900 flex flex-col overflow-hidden">
      
      {/* Tactical Header */}
      <div className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-xl shadow-sm mb-4 flex-none">
        <div className="flex items-center gap-3">
          <img src="/logo-transparent.png" alt="Logo" className="w-7 h-7 object-contain" onError={(e) => e.target.style.display='none'} />
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-800">Rescue Terminal</h1>
            <div className="text-[10px] text-blue-600 font-bold tracking-widest uppercase flex items-center gap-1">
                <Target size={10}/> Active Unit Tracking
            </div>
          </div>
        </div>
        <div className="bg-red-50 px-3 py-1.5 rounded border border-red-200 font-bold flex items-center gap-1.5 text-xs text-red-700 shadow-sm">
            {targets.length} TARGETS
        </div>
      </div>
      
      {/* Map */}
      <div className="h-48 md:h-64 rounded-xl overflow-hidden border border-slate-200 shadow-sm mb-4 relative z-0 flex-none bg-white">
        <MapContainer center={rescuerLocation ? [rescuerLocation.lat, rescuerLocation.lng] : [12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          
          {targets.map((user) => (
            user.lat && user.lng && user.status === "TRAPPED" ? (
              <Marker key={user.id} position={[user.lat, user.lng]} icon={victimIcon}>
                <Popup className="font-sans">
                  <b className="text-red-600 text-sm">{user.victimName || user.id}</b><br/>
                  <span className="text-xs text-slate-600 font-medium">Requires Extraction</span>
                </Popup>
              </Marker>
            ) : null
          ))}

          {rescuerLocation && (
            <Marker position={[rescuerLocation.lat, rescuerLocation.lng]} icon={rescuerIcon}>
              <Popup className="font-sans"><b className="text-blue-600">Alpha Unit</b><br/><span className="text-xs">Your Location</span></Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2 px-1 uppercase tracking-wider flex-none">
        <Navigation size={14} className="text-blue-600"/> Active Extractions
      </div>

      {/* Scrollable Target List */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-6 scroll-smooth">
        {targets.map(target => {
          const isPending = target.status === "RESCUED_PENDING";

          return (
            <div key={target.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden flex-none">
              
              <div className={`absolute top-0 left-0 w-1.5 h-full ${isPending ? 'bg-amber-500' : 'bg-red-500'}`}></div>

              <div className="flex justify-between items-start pl-2">
                <div>
                    <span className="font-bold text-slate-800 text-sm">{target.victimName || target.id}</span>
                    <div className="text-slate-500 text-[10px] flex items-center gap-1 mt-1 font-mono">
                        <Clock size={10}/> {target.timestamp ? new Date(target.timestamp).toLocaleTimeString() : "Time Unknown"}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    {isPending ? (
                      <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock3 size={10}/> Awaiting Confirmation
                      </span>
                    ) : (
                      <span className="bg-red-100 text-red-800 border border-red-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        TRAPPED
                      </span>
                    )}
                </div>
              </div>

              <div className="ml-2 bg-slate-50 p-2.5 rounded-md border border-slate-100">
                  <div className="text-[10px] text-blue-600 font-bold mb-1 flex items-center gap-1"><MessageSquare size={12}/> CCAI ASSESSMENT</div>
                  <p className="text-xs font-medium leading-relaxed text-slate-700">
                      {target.aiTriage || "Assessment Pending..."}
                  </p>
              </div>

              <div className="flex flex-col gap-2 ml-2">
                {target.audioRecordBase64 && (
                    <audio controls src={target.audioRecordBase64} className="w-full h-8" />
                )}
                {target.photoBase64 && (
                    <img src={target.photoBase64} alt="incident" className="w-full h-32 object-cover rounded border border-slate-200" />
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="ml-2 mt-2 flex flex-col gap-2">
                <a 
                  href={`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`} 
                  target="_blank" rel="noreferrer"
                  className="block text-center w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-lg transition shadow-md flex justify-center items-center gap-2"
                >
                  <MapPin size={14}/> Route to Extraction Point
                </a>

                <div className="flex gap-2">
                  <button 
                    onClick={() => handleMarkInProgress(target.id)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2.5 rounded-lg border border-slate-300 transition"
                  >
                    In Progress
                  </button>
                  <button 
                    onClick={() => handleMarkRescued(target.id)}
                    disabled={isPending}
                    className={`flex-1 text-xs font-bold py-2.5 rounded-lg shadow-sm transition flex items-center justify-center gap-1.5 ${
                      isPending ? 'bg-amber-100 text-amber-700 border border-amber-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    <CheckCircle2 size={14}/> {isPending ? 'Awaiting Command...' : 'Mark Rescued'}
                  </button>
                </div>
              </div>

            </div>
          );
        })}
        {targets.length === 0 && (
          <div className="text-center text-sm text-slate-400 font-medium py-10 bg-white border border-slate-200 rounded-xl">All sectors clear.</div>
        )}
      </div>
    </div>
  );
}