import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, XCircle, Battery, Wifi, WifiOff, Minus, Plus, AlertTriangle, Network, Settings2 } from 'lucide-react';
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore'; 
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

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

  if (isBlackout) return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6 text-center">
        <ShieldAlert size={64} className="text-red-600 mb-4" />
        <h1 className="text-slate-900 text-2xl font-bold uppercase tracking-wide">Emergency Beacon Active</h1>
    </div>
  );

  if (falseAlarmTimer !== null) return (
    <div className="min-h-screen bg-red-600 flex flex-col justify-center items-center p-6 text-center text-white z-50 fixed inset-0">
        <ShieldAlert size={80} className="text-white animate-pulse mb-6" />
        <h1 className="text-3xl font-bold mb-2 uppercase tracking-wider">Critical Event Detected</h1>
        <div className="text-8xl font-bold mb-12 tabular-nums">{falseAlarmTimer}</div>
        <button onClick={cancelFalseAlarm} className="w-full bg-white text-red-600 p-5 rounded-lg shadow-lg flex justify-center items-center gap-3 text-lg font-bold">
            <XCircle size={28} /> Cancel Alarm (Safe)
        </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col font-sans text-slate-900">
      <video ref={videoRef} playsInline autoPlay muted className="hidden" />
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
            <img src="/logo-transparent.png" alt="Logo" className="w-6 h-6 object-contain" onError={(e) => e.target.style.display='none'} />
            <h1 className="text-lg font-bold tracking-tight text-emerald-700">STATUS: SAFE</h1>
        </div>
        <div className="flex gap-4 text-xs font-semibold text-slate-500 items-center">
          <span className={`flex items-center gap-1 ${isOnline ? 'text-blue-600' : 'text-red-600'}`}>
            {isOnline ? <Wifi size={14} strokeWidth={2.5}/> : <WifiOff size={14}/>} {networkType.toUpperCase()}
          </span>
          {batteryLvl !== null && <span className="flex items-center gap-1 text-slate-600"><Battery size={14} strokeWidth={2.5}/> {batteryLvl}%</span>}
        </div>
      </div>

      {/* Mesh Relay Card */}
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-4 shadow-sm flex items-center justify-between">
        <div className="flex flex-col">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-1"><Network size={14}/> Mesh Relay Active</span>
            <span className="text-sm font-medium text-slate-600 mt-1">Your device is routing offline packets.</span>
        </div>
        <div className="bg-white px-3 py-1.5 rounded border border-blue-100 text-blue-700 font-bold text-lg shadow-sm">
            {trappedCitizens.length}
        </div>
      </div>

      {/* Mini Map */}
      <div className="flex-none h-[250px] rounded-xl overflow-hidden border border-slate-200 shadow-sm mb-4 relative z-0">
        <div className="absolute top-2 left-2 z-[400] bg-white px-3 py-1.5 rounded-md border border-red-200 text-[10px] text-red-600 font-bold flex items-center gap-1 shadow-md">
            <AlertTriangle size={12}/> {trappedCitizens.length} NEARBY INCIDENTS
        </div>
        <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {trappedCitizens.map((user) => (
            user.lat && user.lng ? ( <Marker key={user.id} position={[user.lat, user.lng]}><Popup><b>{user.victimName || user.id}</b></Popup></Marker> ) : null
          ))}
        </MapContainer>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        {/* Live Readings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-start gap-1">
            <div className="flex items-center gap-1 text-slate-400 mb-1"><Activity size={14}/><span className="text-[10px] font-bold uppercase">Background Motion</span></div>
            <div className="flex items-baseline gap-1"><span className="font-mono text-2xl font-bold">{motionMS2.toFixed(1)}</span><span className="text-xs text-slate-400 font-medium">m/s²</span></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-start gap-1">
            <div className="flex items-center gap-1 text-slate-400 mb-1"><Mic size={14}/><span className="text-[10px] font-bold uppercase">Background Audio</span></div>
            <div className="flex items-baseline gap-1"><span className="font-mono text-2xl font-bold">{audioDB.toFixed(0)}</span><span className="text-xs text-slate-400 font-medium">dB</span></div>
          </div>
        </div>

        {/* RESTORED THRESHOLD CONTROLS */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm border-b border-slate-100 pb-2">
                <Settings2 size={16}/> Configuration
            </div>
            
            <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Motion Trigger</span>
                <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button onClick={() => setMotionThreshold(p => Math.max(2, p - 1))} className="p-1.5 hover:bg-white rounded-md text-slate-600 shadow-sm transition"><Minus size={14}/></button>
                    <span className="w-10 text-center font-mono font-bold text-sm text-slate-800">{motionThreshold}</span>
                    <button onClick={() => setMotionThreshold(p => Math.min(50, p + 1))} className="p-1.5 hover:bg-white rounded-md text-slate-600 shadow-sm transition"><Plus size={14}/></button>
                </div>
            </div>
            
            <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Audio Trigger</span>
                <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button onClick={() => setAudioThreshold(p => Math.max(10, p - 5))} className="p-1.5 hover:bg-white rounded-md text-slate-600 shadow-sm transition"><Minus size={14}/></button>
                    <span className="w-10 text-center font-mono font-bold text-sm text-slate-800">{audioThreshold}</span>
                    <button onClick={() => setAudioThreshold(p => Math.min(120, p + 5))} className="p-1.5 hover:bg-white rounded-md text-slate-600 shadow-sm transition"><Plus size={14}/></button>
                </div>
            </div>
        </div>

        {!sensorsActive && (
          <button onClick={enableSensors} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-semibold shadow-md">Activate Background Monitoring</button>
        )}
      </div>

      <div className="mt-6">
        <button onClick={() => handleTrapped()} className="w-full bg-red-600 hover:bg-red-700 text-white shadow-md p-4 rounded-xl flex justify-center items-center gap-2">
            <ShieldAlert size={20} /> <span className="font-semibold text-sm uppercase tracking-wide">Manual Override: I Am Trapped</span>
        </button>
      </div>
    </div>
  );
}