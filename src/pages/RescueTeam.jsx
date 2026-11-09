import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Target, MapPin, Navigation, Clock, MessageSquare, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';

// Bypass Leaflet tracking prevention blockers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

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

// ---------------------------------------------------------------------------
// STEP 4: useMap hook component — dynamically recenters map on rescuer GPS
// Must be rendered as a child of <MapContainer>
// ---------------------------------------------------------------------------
function MapRecenter({ location }) {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.setView([location.lat, location.lng], map.getZoom(), { animate: true });
    }
  }, [location, map]);
  return null;
}

export default function RescueTeam() {
  const { currentUser } = useAuth();
  const [targets, setTargets] = useState([]);
  const [rescuerLocation, setRescuerLocation] = useState(null);
  // Augmented targets = public + private data joined
  const [augmentedTargets, setAugmentedTargets] = useState([]);

  // ---------------------------------------------------------------------------
  // STEP 4: Zombie cleanup — robust useEffect for all external resources
  // ---------------------------------------------------------------------------
  const geoWatchIdRef = useRef(null);

  const fetchTargets = useCallback(async () => {
    try {
      const { data: publicData, error: pubErr } = await supabase
        .from('incidents_public')
        .select('*')
        .in('status', ['TRAPPED', 'EN_ROUTE', 'RESCUED_PENDING'])
        .order('timestamp', { ascending: false });

      if (pubErr) {
        console.warn("Error fetching rescue targets:", pubErr);
        return;
      }

      const activeList = publicData || [];
      setTargets(activeList);

      const ids = activeList.map(t => t.id);
      if (ids.length > 0) {
        const { data: privData } = await supabase
          .from('incidents_private')
          .select('*')
          .in('id', ids);

        const privMap = {};
        if (privData) {
          privData.forEach(p => { privMap[p.id] = p; });
        }

        const merged = activeList.map(t => ({
          ...t,
          ...(privMap[t.id] || {})
        }));
        setAugmentedTargets(merged);
      } else {
        setAugmentedTargets([]);
      }
    } catch (err) {
      console.warn("fetchTargets exception:", err);
    }
  }, []);

  useEffect(() => {
    fetchTargets();

    // Supabase Realtime subscriptions
    const channel = supabase
      .channel('rescue_incidents_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents_public' },
        () => fetchTargets()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents_private' },
        () => fetchTargets()
      )
      .subscribe();

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => setRescuerLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => console.warn("Rescue GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    // Cleanup: unsubscribe Realtime channel + clear GPS watch
    return () => {
      supabase.removeChannel(channel);
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
    };
  }, [fetchTargets]);

  // ---------------------------------------------------------------------------
  // STEP 4: "Claim Incident" — sets EN_ROUTE and attaches rescuerId
  // This prevents multiple rescuers from claiming the same victim
  // ---------------------------------------------------------------------------
  const handleClaimIncident = async (id) => {
    try {
      const rescuerId = currentUser?.id || currentUser?.uid || "unknown-rescuer";
      await supabase
        .from('incidents_public')
        .update({
          status: "EN_ROUTE",
          rescuerId: rescuerId,
        })
        .eq('id', id);
      fetchTargets();
    } catch (err) {
      console.error("Failed to claim incident:", err);
    }
  };

  const handleMarkRescued = async (id) => {
    try {
      await supabase
        .from('incidents_public')
        .update({ status: "RESCUED_PENDING" })
        .eq('id', id);
      fetchTargets();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  return (
    <div className="h-screen bg-[#FAFAFA] p-4 md:p-6 font-['Inter',sans-serif] antialiased text-[#171717] flex flex-col overflow-hidden max-w-2xl mx-auto w-full">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
      
      {/* Tactical Header */}
      <div className="flex items-center justify-between bg-white border border-black/[0.04] px-5 py-4 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] mb-5 flex-none z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#171717] rounded-xl flex items-center justify-center shadow-sm">
              <Target size={20} className="text-white" strokeWidth={2}/>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#171717]">Rescue Terminal</h1>
            <div className="text-[10px] text-blue-600 font-bold tracking-widest uppercase mt-0.5">
                Alpha Unit Field Ops
            </div>
          </div>
        </div>
        <div className="bg-red-50 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-red-700 shadow-sm border border-red-100">
            {targets.length} Targets
        </div>
      </div>
      
      {/* Map Module — MapRecenter child dynamically recenters on GPS updates */}
      <div className="h-56 md:h-72 rounded-[24px] overflow-hidden border border-black/[0.06] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] mb-6 relative z-0 flex-none bg-white">
        <MapContainer
          center={rescuerLocation ? [rescuerLocation.lat, rescuerLocation.lng] : [12.9525, 74.8806]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* Dynamic recentering — fires whenever rescuerLocation changes */}
          <MapRecenter location={rescuerLocation} />
          
          {targets.map((user) => (
            user.lat && user.lng && user.status === "TRAPPED" ? (
              <Marker key={user.id} position={[user.lat, user.lng]} icon={victimIcon}>
                <Popup className="font-sans">
                  <b className="text-red-600 text-sm block mb-1">{user.victimName || user.id}</b>
                  <span className="text-[#737373] text-[11px] font-semibold uppercase tracking-widest">Requires Extraction</span>
                </Popup>
              </Marker>
            ) : null
          ))}

          {rescuerLocation && (
            <Marker position={[rescuerLocation.lat, rescuerLocation.lng]} icon={rescuerIcon}>
              <Popup className="font-sans"><b className="text-blue-600 block mb-1">Alpha Unit</b><span className="text-[#737373] text-[11px] font-semibold uppercase tracking-widest">Your Location</span></Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="flex items-center gap-2 text-[11px] font-semibold text-[#737373] mb-3 px-2 uppercase tracking-widest flex-none">
        <Navigation size={14} className="text-[#171717]"/> Active Extractions
      </div>

      {/* Scrollable Target List */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-10 scroll-smooth px-1">
        {augmentedTargets.map(target => {
          const isPending = target.status === "RESCUED_PENDING";
          const isEnRoute = target.status === "EN_ROUTE";

          return (
            <div key={target.id} className={`bg-white border p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] flex flex-col gap-3 relative overflow-hidden flex-none ${isPending ? 'border-amber-200' : isEnRoute ? 'border-blue-200' : 'border-black/[0.06]'}`}>
              
              {/* Status Ribbon */}
              <div className={`absolute top-0 left-0 w-1.5 h-full ${isPending ? 'bg-amber-500' : isEnRoute ? 'bg-blue-500' : 'bg-red-500'}`}></div>

              <div className="flex justify-between items-start pl-2 border-b border-black/[0.04] pb-3">
                <div>
                    <span className="font-semibold text-sm text-[#171717]">{target.victimName || target.id}</span>
                    <div className="text-[#737373] text-[11px] flex items-center gap-1.5 mt-1 font-medium">
                        <Clock size={12}/> {target.timestamp ? new Date(target.timestamp).toLocaleTimeString() : "Time Unknown"}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    {isPending ? (
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest">
                        <Clock3 size={12}/> Awaiting Command
                      </span>
                    ) : isEnRoute ? (
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-widest flex items-center gap-1">
                        <Navigation size={12}/> En Route
                      </span>
                    ) : (
                      <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-widest flex items-center gap-1">
                        <AlertTriangle size={12}/> Trapped
                      </span>
                    )}
                </div>
              </div>

              {/* CCAI Assessment Bubble */}
              <div className="ml-2 bg-[#FAFAFA] p-3.5 rounded-[16px] border border-black/[0.04] mt-1">
                  <div className="text-[10px] text-[#171717] font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-widest">
                      <MessageSquare size={14}/> CCAI Intelligence
                      {target.priorityLevel != null && (
                        <span className={`ml-auto px-2 py-0.5 rounded-md text-[9px] font-bold ${target.priorityLevel >= 8 ? 'bg-red-100 text-red-700' : target.priorityLevel >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          P{target.priorityLevel}/10
                        </span>
                      )}
                  </div>
                  <p className="text-[13px] font-medium leading-relaxed text-[#404040]">
                      {target.aiTriage || "Assessment Pending..."}
                  </p>
              </div>

              {/* Media Block — now uses Storage download URLs */}
              <div className="flex flex-col gap-3 ml-2 mt-1">
                {target.audioUrl && (
                    <audio controls src={target.audioUrl} className="w-full h-10 outline-none" />
                )}
                {target.photoUrl && (
                    <img src={target.photoUrl} alt="incident" className="w-full h-40 object-cover rounded-[16px] border border-black/[0.06] shadow-sm" />
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="ml-2 mt-4 flex flex-col gap-3">
                <a 
                  href={`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`} 
                  target="_blank" rel="noreferrer"
                  className="block text-center w-full bg-[#171717] hover:bg-black text-white text-[13px] font-medium py-3.5 rounded-[16px] transition-all shadow-[0_4px_12px_rgba(0,0,0,0.1)] flex justify-center items-center gap-2"
                >
                  <MapPin size={16}/> Route to Extraction Point
                </a>

                <div className="flex gap-3">
                  {/* CLAIM INCIDENT — sets EN_ROUTE and attaches rescuerId */}
                  <button 
                    onClick={() => handleClaimIncident(target.id)}
                    disabled={isEnRoute || isPending}
                    className={`flex-1 text-[13px] font-medium py-3 rounded-[16px] transition-colors ${isEnRoute ? 'bg-blue-50 text-blue-700 cursor-not-allowed opacity-70' : isPending ? 'bg-[#F5F5F5] text-[#737373] cursor-not-allowed opacity-50' : 'bg-[#F5F5F5] hover:bg-[#E5E5E5] text-[#171717]'}`}
                  >
                    {isEnRoute ? 'Claimed' : 'Claim Incident'}
                  </button>
                  <button 
                    onClick={() => handleMarkRescued(target.id)}
                    disabled={isPending}
                    className={`flex-1 text-[13px] font-medium py-3 rounded-[16px] transition-all flex items-center justify-center gap-1.5 ${
                      isPending ? 'bg-amber-50 text-amber-700 cursor-not-allowed opacity-70' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    <CheckCircle2 size={16}/> {isPending ? 'Pending Close...' : 'Mark Rescued'}
                  </button>
                </div>
              </div>

            </div>
          );
        })}
        {targets.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4 opacity-60">
              <CheckCircle2 size={48} className="text-[#737373] mb-4 stroke-1"/>
              <p className="text-[15px] font-medium text-[#737373]">All sectors clear.<br/>No extraction targets active.</p>
          </div>
        )}
      </div>
    </div>
  );
}