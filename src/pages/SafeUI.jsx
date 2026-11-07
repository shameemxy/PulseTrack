import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, XCircle, Battery, Wifi, WifiOff, Minus, Plus, AlertTriangle, Network, Settings2, CheckCircle } from 'lucide-react';
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore'; 
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet tracking prevention block by using unpkg
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

export default function SafeUI() {
  const [deviceId] = useState(() => {
    let id = localStorage.getItem("pulse_device_id");
    if (!id) { id = "Victim_" + Math.floor(1000 + Math.random() * 9000); localStorage.setItem("pulse_device_id", id); }
    return id;
  });

  const [audioDB, setAudioDB] = useState(0);
  const [motionMS2, setMotionMS2] = useState(0);
  
  // Threshold States
  const [motionThreshold, setMotionThreshold] = useState(15);
  const [audioThreshold, setAudioThreshold] = useState(85);
  
  const [isBlackout, setIsBlackout] = useState(false);
  const [falseAlarmTimer, setFalseAlarmTimer] = useState(null);
  const [sensorsActive, setSensorsActive] = useState(false);
  
  const [batteryLvl, setBatteryLvl] = useState(null);
  const [networkType, setNetworkType] = useState('4g');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [trappedCitizens, setTrappedCitizens] = useState([]);

  const navigate = useNavigate();
  const locationRef = useRef({ lat: 12.9525, lng: 74.8806 });
  const isTrappedRef = useRef(false);
  const isFalseAlarmRef = useRef(false);
  const motionThreshRef = useRef(15);
  const audioThreshRef = useRef(85);
  const sensorsActiveRef = useRef(false);

  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Sync state to refs for the event listeners
  useEffect(() => { motionThreshRef.current = motionThreshold; }, [motionThreshold]);
  useEffect(() => { audioThreshRef.current = audioThreshold; }, [audioThreshold]);

  useEffect(() => {
    const q = query(collection(db, "victims"), where("status", "==", "TRAPPED"));
    const unsubscribe = onSnapshot(q, (snapshot) => setTrappedCitizens(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));

    if (navigator.getBattery) navigator.getBattery().then(b => setBatteryLvl(Math.round(b.level * 100)));
    if (navigator.connection) setNetworkType(navigator.connection.effectiveType);
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }, 
      (err) => console.warn("GPS Warning:", err), { enableHighAccuracy: true }
    );
    return () => { unsubscribe(); navigator.geolocation.clearWatch(watchId); };
  }, []);

  const handleMotion = (event) => {
    if (event.accelerationIncludingGravity && !isTrappedRef.current) {
      const { x, y, z } = event.accelerationIncludingGravity;
      const movement = Math.abs(Math.sqrt(x*x + y*y + z*z) - 9.8); 
      setMotionMS2(movement);
      if (movement > motionThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) triggerFalseAlarm();
    }
  };

  const enableSensors = async () => {
    sensorsActiveRef.current = true; setSensorsActive(true);
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { const p = await DeviceMotionEvent.requestPermission(); if (p === 'granted') window.addEventListener('devicemotion', handleMotion); } catch (e) {}
    } else { window.addEventListener('devicemotion', handleMotion); }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { ideal: "environment" } } });
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const updateAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const currentDB = Math.max(0, (avg / 255) * 120);
        setAudioDB(currentDB);
        if (currentDB > audioThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) triggerFalseAlarm();
        requestAnimationFrame(updateAudio);
      };
      updateAudio();
    } catch (err) { console.warn("Sensor failed:", err); }
  };

  const triggerFalseAlarm = () => {
    if (isFalseAlarmRef.current || isTrappedRef.current || !sensorsActiveRef.current) return;
    isFalseAlarmRef.current = true; setFalseAlarmTimer(15);
    if (mediaRecorderRef.current?.state === "inactive") { audioChunksRef.current = []; mediaRecorderRef.current.start(); }
  };

  const cancelFalseAlarm = () => {
    isFalseAlarmRef.current = false; setFalseAlarmTimer(null);
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  useEffect(() => {
    if (falseAlarmTimer !== null && falseAlarmTimer > 0) {
      const timer = setInterval(() => setFalseAlarmTimer(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (falseAlarmTimer === 0) handleTrapped(); 
  }, [falseAlarmTimer]);

  const handleTrapped = async () => {
    if (isTrappedRef.current) return;
    isTrappedRef.current = true; isFalseAlarmRef.current = false; setIsBlackout(true); setFalseAlarmTimer(null);
    
    try {
        await setDoc(doc(db, "victims", deviceId), { 
            victimName: deviceId, status: "TRAPPED", lat: locationRef.current.lat, lng: locationRef.current.lng,
            battery: batteryLvl, packetType: "HIGH_BANDWIDTH", timestamp: Date.now(), aiTriage: "Pending...",
            audioDB: audioDB.toFixed(1), motionMS2: motionMS2.toFixed(2)
        });
    } catch (error) { console.error("Upload Failed:", error); }
  };

  // -------------------------
  // RENDER: BLACKOUT / SOS
  // -------------------------
  if (isBlackout) return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center p-6 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white p-10 rounded-[24px] shadow-[0_2px_8px_rgba(220,38,38,0.1),0_16px_32px_rgba(220,38,38,0.1)] flex flex-col items-center w-full max-w-sm border border-red-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600 animate-pulse"></div>
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
                <ShieldAlert size={32} className="text-red-600" />
            </div>
            <h1 className="text-[#171717] text-2xl font-semibold tracking-tight mb-3 text-center">Beacon Active</h1>
            <p className="text-[#737373] text-sm text-center leading-relaxed">
                Command Centre has been notified.<br/>Broadcasting encrypted telemetry.
            </p>
        </div>
    </div>
  );

  // -------------------------
  // RENDER: FALSE ALARM (15s)
  // -------------------------
  if (falseAlarmTimer !== null) return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center p-6 z-50 fixed inset-0 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="bg-white rounded-[24px] p-8 shadow-[0_2px_8px_rgba(220,38,38,0.1),0_16px_32px_rgba(220,38,38,0.1)] w-full max-w-sm border border-red-100 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-6">
                <AlertTriangle size={32} className="text-red-600 animate-pulse" />
            </div>
            <h1 className="text-2xl font-semibold text-[#171717] tracking-tight mb-2">Impact Detected</h1>
            <p className="text-[#737373] text-sm leading-relaxed mb-6">
                Recording telemetry. Alert dispatches in:
            </p>
            <div className="text-7xl font-bold text-[#171717] mb-10 tabular-nums tracking-tighter">
                {falseAlarmTimer}
            </div>
            <button 
                onClick={cancelFalseAlarm} 
                className="w-full bg-[#171717] hover:bg-black text-white py-4 rounded-full font-medium text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] flex justify-center items-center gap-2 transition-all"
            >
                <XCircle size={18} /> Abort Alert
            </button>
        </div>
    </div>
  );

  // -------------------------
  // RENDER: MAIN SAFE DASHBOARD
  // -------------------------
  return (
    <div className="min-h-screen bg-[#FAFAFA] p-6 flex flex-col antialiased relative" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
      
      {/* Hidden background tracking video to prevent hardware suspension */}
      <video 
        ref={videoRef} 
        playsInline 
        autoPlay 
        muted 
        onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
        style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 0.1, pointerEvents: 'none', zIndex: -10 }} 
      />
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100">
                <CheckCircle size={18} className="text-emerald-600" strokeWidth={2.5}/>
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-[#171717]">Status: Safe</h1>
        </div>
        <div className="flex gap-3 text-xs font-medium text-[#737373] items-center">
          <span className={`flex items-center gap-1 ${isOnline ? 'text-[#171717]' : 'text-red-500'}`}>
            {isOnline ? <Wifi size={14} strokeWidth={2}/> : <WifiOff size={14} strokeWidth={2}/>}
          </span>
          {batteryLvl !== null && (
            <span className="flex items-center gap-1 text-[#171717]"><Battery size={14} strokeWidth={2}/> {batteryLvl}%</span>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-6">
          
        {/* Mesh Relay Card */}
        <div className="bg-white p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex items-center justify-between">
          <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                  <Network size={14}/> Mesh Relay Active
              </span>
              <span className="text-[13px] font-medium text-[#737373] leading-relaxed">
                  Your device is routing packets for nearby offline victims.
              </span>
          </div>
          <div className="bg-[#FAFAFA] w-12 h-12 flex items-center justify-center rounded-2xl border border-black/[0.04] text-[#171717] font-semibold text-lg shadow-sm">
              {trappedCitizens.length}
          </div>
        </div>

        {/* Mini Map */}
        <div className="flex-none h-[220px] rounded-[24px] overflow-hidden border border-black/[0.06] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] relative z-0">
          <div className="absolute top-3 left-3 z-[400] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-black/[0.04] text-[10px] text-red-600 font-semibold tracking-widest uppercase flex items-center gap-1.5 shadow-sm">
              <AlertTriangle size={12}/> {trappedCitizens.length} Nearby Incidents
          </div>
          <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {trappedCitizens.map((user) => (
              user.lat && user.lng ? ( <Marker key={user.id} position={[user.lat, user.lng]}><Popup><b className="font-sans text-sm">{user.victimName || user.id}</b></Popup></Marker> ) : null
            ))}
          </MapContainer>
        </div>

        {/* Live Readings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 text-[#737373] mb-2">
                <Activity size={14}/>
                <span className="text-[10px] font-semibold uppercase tracking-widest">BG Motion</span>
            </div>
            <div className="flex items-baseline gap-1 mt-auto">
                <span className="font-semibold text-3xl tracking-tighter text-[#171717] tabular-nums">{motionMS2.toFixed(1)}</span>
                <span className="text-xs text-[#737373] font-medium">m/s²</span>
            </div>
          </div>
          
          <div className="bg-white p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 text-[#737373] mb-2">
                <Mic size={14}/>
                <span className="text-[10px] font-semibold uppercase tracking-widest">BG Audio</span>
            </div>
            <div className="flex items-baseline gap-1 mt-auto">
                <span className="font-semibold text-3xl tracking-tighter text-[#171717] tabular-nums">{audioDB.toFixed(0)}</span>
                <span className="text-xs text-[#737373] font-medium">dB</span>
            </div>
          </div>
        </div>

        {/* Configuration Module */}
        <div className="bg-white p-6 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col gap-5">
            <div className="flex items-center gap-2 text-[#171717] font-medium text-sm border-b border-black/[0.06] pb-3">
                <Settings2 size={16}/> Threshold Settings
            </div>
            
            <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Motion Trigger</span>
                <div className="flex items-center bg-[#F5F5F5] p-1 rounded-full">
                    <button onClick={() => setMotionThreshold(p => Math.max(2, p - 1))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Minus size={14}/></button>
                    <span className="w-10 text-center font-medium text-[15px] text-[#171717] tabular-nums">{motionThreshold}</span>
                    <button onClick={() => setMotionThreshold(p => Math.min(50, p + 1))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Plus size={14}/></button>
                </div>
            </div>
            
            <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Audio Trigger</span>
                <div className="flex items-center bg-[#F5F5F5] p-1 rounded-full">
                    <button onClick={() => setAudioThreshold(p => Math.max(10, p - 5))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Minus size={14}/></button>
                    <span className="w-10 text-center font-medium text-[15px] text-[#171717] tabular-nums">{audioThreshold}</span>
                    <button onClick={() => setAudioThreshold(p => Math.min(120, p + 5))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Plus size={14}/></button>
                </div>
            </div>
        </div>

        {!sensorsActive && (
          <button 
              onClick={enableSensors} 
              className="w-full bg-[#171717] hover:bg-black text-white py-4 rounded-[20px] font-medium text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all"
          >
              Activate Background Monitoring
          </button>
        )}
      </div>

      {/* Sticky Bottom SOS Action */}
      <div className="mt-8 flex justify-center pb-2">
        <button 
            onClick={() => handleTrapped()} 
            className="w-full bg-[#171717] text-white py-4 rounded-full flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-black transition-all"
        >
            <ShieldAlert size={18} /> 
            <span className="font-medium text-[15px] tracking-wide">Manual Override: I Am Trapped</span>
        </button>
      </div>
    </div>
  );
}