import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, XCircle, Battery, Wifi, WifiOff, Minus, Plus, AlertTriangle, Network, Settings2, CheckCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Bypass Leaflet tracking prevention blockers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

export default function SafeUI() {
  const navigate = useNavigate();

  // ---------------------------------------------------------------------------
  // AUTH: Sign in anonymously to get a stable Supabase / device ID
  // ---------------------------------------------------------------------------
  const { currentUser, isLoading: authLoading, signInAnonymously } = useAuth();

  useEffect(() => {
    if (!authLoading && !currentUser) {
      signInAnonymously().catch(err => console.error("Anon sign-in failed:", err));
    }
  }, [currentUser, authLoading, signInAnonymously]);

  const deviceId = currentUser?.uid || currentUser?.id || null;

  const [audioDB, setAudioDB] = useState(0);
  const [motionMS2, setMotionMS2] = useState(0);
  
  const [motionHistory, setMotionHistory] = useState(Array(30).fill(0));
  const [audioHistory, setAudioHistory] = useState(Array(30).fill(0));

  const currentMotionRef = useRef(0);
  const currentAudioRef = useRef(0);
  const peakMotionRef = useRef(0);
  const peakAudioRef = useRef(0);
  const lastAccRef = useRef({ x: null, y: null, z: null });
  
  // Threshold States
  const [motionThreshold, setMotionThreshold] = useState(15);
  const [audioThreshold, setAudioThreshold] = useState(85);
  
  const [isBlackout, setIsBlackout] = useState(false);
  const [falseAlarmTimer, setFalseAlarmTimer] = useState(null);
  const [sensorsActive, setSensorsActive] = useState(false);
  const [triggerReason, setTriggerReason] = useState(null);
  
  const [batteryLvl, setBatteryLvl] = useState(null);
  const [networkType, setNetworkType] = useState('4g');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [trappedCitizens, setTrappedCitizens] = useState([]);

  const locationRef = useRef({ lat: 12.9525, lng: 74.8806 });
  const isTrappedRef = useRef(false);
  const isFalseAlarmRef = useRef(false);
  const motionThreshRef = useRef(15);
  const audioThreshRef = useRef(85);
  const sensorsActiveRef = useRef(false);

  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const audioCtxRef = useRef(null);
  const sirenIntervalRef = useRef(null);

  // Sync state to refs for the event listeners
  useEffect(() => { motionThreshRef.current = motionThreshold; }, [motionThreshold]);
  useEffect(() => { audioThreshRef.current = audioThreshold; }, [audioThreshold]);

  // Clean up Zombie Streams on Unmount
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
      try { recognitionRef.current?.stop(); } catch(e) {}
      if (sirenIntervalRef.current) clearInterval(sirenIntervalRef.current);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, []);

  useEffect(() => {
    // Listen for nearby trapped citizens from incidents_public via Supabase
    const fetchTrappedCitizens = async () => {
      const { data } = await supabase
        .from('incidents_public')
        .select('*')
        .eq('status', 'TRAPPED');
      if (data) setTrappedCitizens(data);
    };

    fetchTrappedCitizens();

    const channel = supabase
      .channel('safe_trapped_citizens')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents_public'
        },
        () => {
          fetchTrappedCitizens();
        }
      )
      .subscribe();

    if (navigator.getBattery) navigator.getBattery().then(b => setBatteryLvl(Math.round(b.level * 100)));
    if (navigator.connection) setNetworkType(navigator.connection.effectiveType);
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }, 
      (err) => console.warn("GPS Warning:", err), { enableHighAccuracy: true }
    );
    
    return () => { 
        supabase.removeChannel(channel); 
        navigator.geolocation.clearWatch(watchId); 
    };
  }, []);

  // Live Graph Animation Loop
  useEffect(() => {
    if (!sensorsActive) return;
    const interval = setInterval(() => {
      const mVal = currentMotionRef.current;
      const motionY = Math.min((mVal / 50) * 100, 100); 

      const aVal = currentAudioRef.current;
      const audioY = Math.min((aVal / 120) * 100, 100);

      setMotionHistory(prev => [...prev.slice(1), motionY]);
      setAudioHistory(prev => [...prev.slice(1), audioY]);
    }, 100); 
    return () => clearInterval(interval);
  }, [sensorsActive]);

  // Unified Math to match VictimUI
  const handleMotion = (event) => {
    if (isTrappedRef.current) return;
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;

    let movement = 0;
    if (event.acceleration) {
      const { x, y, z } = acc;
      if (lastAccRef.current.x !== null) {
        movement = Math.abs(x - lastAccRef.current.x) + Math.abs(y - lastAccRef.current.y) + Math.abs(z - lastAccRef.current.z);
      }
      lastAccRef.current = { x, y, z };
    } else {
      const { x, y, z } = acc;
      movement = Math.abs(Math.sqrt(x*x + y*y + z*z) - 9.8);
    }

    if (movement < 0.5) movement = 0;
    currentMotionRef.current = movement;
    setMotionMS2(movement);

    if (isFalseAlarmRef.current && movement > peakMotionRef.current) {
        peakMotionRef.current = movement;
    }
    
    if (movement > motionThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) {
      setTriggerReason("IMPACT");
      triggerFalseAlarm();
    }
  };

  // Promise.all Mobile Security Fix applied
  const enableSensors = async () => {
    try {
      if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
      }

      const motionPromise = (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function')
          ? DeviceMotionEvent.requestPermission().catch(() => 'denied')
          : Promise.resolve('granted');

      const mediaPromise = navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: { facingMode: { ideal: "environment" } } 
      }).catch(err => {
          console.error("Media permission denied", err);
          return null;
      });

      const [motionStatus, stream] = await Promise.all([motionPromise, mediaPromise]);

      if (!stream) {
          alert("Camera and Microphone access is strictly required for background monitoring.");
          return;
      }

      const motionGranted = motionStatus === 'granted';

      if (videoRef.current) { 
          videoRef.current.srcObject = stream; 
          videoRef.current.play().catch(e => console.warn("Video play error:", e)); 
      }
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => { 
          if (e.data.size > 0) audioChunksRef.current.push(e.data); 
      };

      const analyser = audioCtxRef.current.createAnalyser();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const updateAudio = () => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
          const currentDB = Math.max(0, (avg / 255) * 120);
          
          currentAudioRef.current = currentDB;
          setAudioDB(currentDB);

          if (isFalseAlarmRef.current && currentDB > peakAudioRef.current) {
              peakAudioRef.current = currentDB;
          }
          
          if (currentDB > audioThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) {
              setTriggerReason("LOUD_SOUND");
              triggerFalseAlarm();
          }
          requestAnimationFrame(updateAudio);
      };
      updateAudio();

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
          recognitionRef.current = new SpeechRecognition();
          recognitionRef.current.continuous = true;
          recognitionRef.current.interimResults = true;
          recognitionRef.current.onresult = (e) => {
              let final = "";
              for (let i = e.resultIndex; i < e.results.length; ++i) {
                  if (e.results[i].isFinal) final += e.results[i][0].transcript;
              }
              transcriptRef.current += final + " ";
          };
          recognitionRef.current.start();
      }

      if (motionGranted) {
          window.addEventListener('devicemotion', handleMotion);
      }
      sensorsActiveRef.current = true;
      setSensorsActive(true);

    } catch (err) {
      console.error("Hardware initialization failed:", err);
    }
  };

  const triggerFalseAlarm = () => {
    if (isFalseAlarmRef.current || isTrappedRef.current || !sensorsActiveRef.current) return;
    isFalseAlarmRef.current = true; 
    setFalseAlarmTimer(15);
    
    peakMotionRef.current = currentMotionRef.current;
    peakAudioRef.current = currentAudioRef.current;
    
    if (mediaRecorderRef.current?.state === "inactive") { 
        audioChunksRef.current = []; 
        mediaRecorderRef.current.start(); 
    }
  };

  const cancelFalseAlarm = () => {
    isFalseAlarmRef.current = false; 
    setFalseAlarmTimer(null);
    setTriggerReason(null);
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  useEffect(() => {
    if (falseAlarmTimer !== null && falseAlarmTimer > 0) {
      const timer = setInterval(() => setFalseAlarmTimer(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (falseAlarmTimer === 0) {
        handleTrapped("TRAPPED"); 
    }
  }, [falseAlarmTimer]);

  // ---------------------------------------------------------------------------
  // STEP 2: Get audio blob (not Base64 — we'll upload to Storage instead)
  // ---------------------------------------------------------------------------
  const getAudioBlob = async () => {
    return new Promise((resolve) => {
      const safetyTimer = setTimeout(() => resolve(null), 1500);
      if (!mediaRecorderRef.current || audioChunksRef.current.length === 0) {
        clearTimeout(safetyTimer);
        return resolve(null);
      }
      mediaRecorderRef.current.onstop = () => {
        clearTimeout(safetyTimer);
        if (audioChunksRef.current.length === 0) return resolve(null);
        const mimeType = mediaRecorderRef.current.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        resolve(blob);
      };
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      } else {
        mediaRecorderRef.current.onstop(); 
      }
    });
  };

  // Upgraded Full SOS Payload for SafeUI
  const handleTrapped = async (finalStatus = "TRAPPED") => {
    if (isTrappedRef.current) return;
    if (!deviceId) {
      console.error("Cannot file incident: Auth UID not available yet.");
      return;
    }
    try { recognitionRef.current?.stop(); } catch(e) {}

    const isLowBandwidth = networkType === '2g' || networkType === 'slow-2g' || !isOnline;
    let photoBlob = null;
    
    if (!isLowBandwidth && videoRef.current && videoRef.current.srcObject) {
      try {
        const video = videoRef.current;
        video.play().catch(()=>{});
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const vW = video.videoWidth > 0 ? video.videoWidth : 320; 
        const vH = video.videoHeight > 0 ? video.videoHeight : 240;
        
        const canvas = document.createElement("canvas");
        canvas.width = vW;
        canvas.height = vH;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, vW, vH);
        photoBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.3));
      } catch (err) {
        console.warn("Canvas drawing failed:", err);
      }
    }

    isTrappedRef.current = true;
    isFalseAlarmRef.current = false;
    setIsBlackout(true);
    setFalseAlarmTimer(null);

    // Fire the Siren
    try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        sirenIntervalRef.current = setInterval(() => {
            if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
            const osc = audioCtxRef.current.createOscillator();
            osc.frequency.setValueAtTime(3000, audioCtxRef.current.currentTime);
            osc.connect(audioCtxRef.current.destination);
            osc.start(); osc.stop(audioCtxRef.current.currentTime + 0.3);
        }, 2000);
    } catch(e) {}

    const audioBlob = isLowBandwidth ? null : await getAudioBlob();

    // ---------------------------------------------------------------------------
    // Upload media to Supabase Storage and get public URLs
    // ---------------------------------------------------------------------------
    let photoUrl = "";
    let audioUrl = "";

    if (!isLowBandwidth) {
      try {
        if (photoBlob) {
          const photoPath = `${deviceId}/photo.jpg`;
          const { error: photoErr } = await supabase.storage
            .from('incident-media')
            .upload(photoPath, photoBlob, { upsert: true, contentType: 'image/jpeg' });
          if (!photoErr) {
            const { data } = supabase.storage.from('incident-media').getPublicUrl(photoPath);
            photoUrl = data?.publicUrl || "";
          }
        }
        if (audioBlob) {
          const audioPath = `${deviceId}/audio.webm`;
          const { error: audioErr } = await supabase.storage
            .from('incident-media')
            .upload(audioPath, audioBlob, { upsert: true, contentType: audioBlob.type || 'audio/webm' });
          if (!audioErr) {
            const { data } = supabase.storage.from('incident-media').getPublicUrl(audioPath);
            audioUrl = data?.publicUrl || "";
          }
        }
      } catch (err) {
        console.warn("Storage upload failed, continuing without media:", err);
      }
    }

    // ---------------------------------------------------------------------------
    // STEP 2: Split write — public telemetry vs. private media/AI data
    // ---------------------------------------------------------------------------
    const publicPayload = {
      id: deviceId,
      victimName: deviceId,
      status: finalStatus,
      triggerReason: triggerReason || "MANUAL_FROM_SAFE",
      lat: locationRef.current.lat,
      lng: locationRef.current.lng,
      battery: batteryLvl,
      packetType: isLowBandwidth ? "LOW_BANDWIDTH" : "HIGH_BANDWIDTH",
      timestamp: Date.now(),
      audioDB: (Math.max(peakAudioRef.current, audioDB)).toFixed(1),
      motionMS2: (Math.max(peakMotionRef.current, motionMS2)).toFixed(2),
    };

    const privatePayload = {
      id: deviceId,
      photoUrl: photoUrl || "",
      audioUrl: audioUrl || "",
      transcript: transcriptRef.current || "No words captured.",
      aiTriage: "Pending...",
      priorityLevel: null,
    };

    try {
      await supabase.from('incidents_public').upsert(publicPayload, { onConflict: 'id' });
      await supabase.from('incidents_private').upsert(privatePayload, { onConflict: 'id' });
    } catch (error) {
      console.error("Supabase Upload Failed:", error);
    }
  };

  const handleCancelSOS = async () => {
    if (sirenIntervalRef.current) clearInterval(sirenIntervalRef.current);
    setIsBlackout(false);
    
    try {
      if (deviceId) {
        await supabase.from('incidents_public').update({ status: "SAFE", timestamp: Date.now() }).eq('id', deviceId);
      }
    } catch (e) {}
    
    window.location.reload();
  };

  const renderGraph = (data, strokeColor) => {
    const points = data.map((val, i) => `${(i / (data.length - 1)) * 100},${100 - val}`).join(" ");
    return (
        <div className="w-full h-12 relative mt-4">
            <svg viewBox="0 -5 100 110" preserveAspectRatio="none" className="w-full h-full">
                <polyline 
                    points={points} 
                    fill="none" 
                    stroke={strokeColor} 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    vectorEffect="non-scaling-stroke" 
                />
            </svg>
        </div>
    );
  };

  // -------------------------
  // GLOBAL RENDER TREE
  // -------------------------
  return (
    <>
      {/* Globally mounted video element to prevent DOM destruction issues */}
      <video 
        ref={videoRef} 
        playsInline 
        autoPlay 
        muted 
        className="hidden"
        style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 0.1, pointerEvents: 'none', zIndex: -10 }} 
      />

      {/* Screen 1: BLACKOUT / SOS */}
      {isBlackout ? (
        <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center p-4 sm:p-6 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
            <div className="bg-white p-8 sm:p-10 rounded-[24px] shadow-[0_2px_8px_rgba(220,38,38,0.1),0_16px_32px_rgba(220,38,38,0.1)] flex flex-col items-center w-full max-w-sm border border-red-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-red-600 animate-pulse"></div>
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
                    <ShieldAlert size={32} className="text-red-600" />
                </div>
                <h1 className="text-[#171717] text-2xl font-semibold tracking-tight mb-3 text-center">Beacon Active</h1>
                <p className="text-[#737373] text-sm text-center leading-relaxed mb-8">
                    Status: TRAPPED<br/>Broadcasting encrypted telemetry.
                </p>
                
                <button 
                    onDoubleClick={handleCancelSOS} 
                    className="text-red-600 border border-red-200 bg-red-50 py-3.5 px-8 rounded-full text-sm font-bold shadow-sm w-full transition-all hover:bg-red-100"
                >
                  Double Tap to Cancel
                </button>
            </div>
        </div>
      ) 
      
      /* Screen 2: FALSE ALARM (15s) */
      : falseAlarmTimer !== null ? (
        <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center p-4 sm:p-6 z-50 fixed inset-0 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
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
      ) 

      /* Screen 3: MAIN SAFE DASHBOARD */
      : (
        <div className="min-h-screen bg-[#FAFAFA] p-4 sm:p-6 flex flex-col antialiased relative" style={{ fontFamily: "'Inter', sans-serif" }}>
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
          
          <div className="flex justify-between items-center mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-9 sm:h-9 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100">
                    <CheckCircle size={16} className="text-emerald-600 sm:w-[18px] sm:h-[18px]" strokeWidth={2.5}/>
                </div>
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[#171717]">Status: Safe</h1>
            </div>
            <div className="flex gap-2 sm:gap-3 text-xs font-medium text-[#737373] items-center">
              <span className={`flex items-center gap-1 ${isOnline ? 'text-[#171717]' : 'text-red-500'}`}>
                {isOnline ? <Wifi size={14} strokeWidth={2}/> : <WifiOff size={14} strokeWidth={2}/>}
              </span>
              {batteryLvl !== null && (
                <span className="flex items-center gap-1 text-[#171717]"><Battery size={14} strokeWidth={2}/> {batteryLvl}%</span>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-4 sm:gap-6">
              
            {/* Mesh Relay Card */}
            <div className="bg-white p-4 sm:p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex items-center justify-between">
              <div className="flex flex-col">
                  <span className="text-[10px] sm:text-[11px] font-semibold text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                      <Network size={14}/> Mesh Relay Active
                  </span>
                  <span className="text-xs sm:text-[13px] font-medium text-[#737373] leading-relaxed">
                      Your device is routing offline packets.
                  </span>
              </div>
              <div className="bg-[#FAFAFA] w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-[14px] sm:rounded-2xl border border-black/[0.04] text-[#171717] font-semibold text-base sm:text-lg shadow-sm">
                  {trappedCitizens.length}
              </div>
            </div>

            {/* Mini Map */}
            <div className="flex-none h-[200px] sm:h-[220px] rounded-[24px] overflow-hidden border border-black/[0.06] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] relative z-0">
              <div className="absolute top-3 left-3 z-[400] bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-black/[0.04] text-[9px] sm:text-[10px] text-red-600 font-semibold tracking-widest uppercase flex items-center gap-1.5 shadow-sm">
                  <AlertTriangle size={12}/> {trappedCitizens.length} Nearby Incidents
              </div>
              <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {trappedCitizens.map((user) => (
                  user.lat && user.lng ? ( <Marker key={user.id} position={[user.lat, user.lng]}><Popup><b className="font-sans text-sm">{user.victimName || user.id}</b></Popup></Marker> ) : null
                ))}
              </MapContainer>
            </div>

            {/* Live Telemetry Readings */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full">
              <div className="bg-white p-4 sm:p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col justify-between overflow-hidden relative min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 text-[#737373] relative z-10">
                    <Activity size={14} strokeWidth={2.5} className="flex-shrink-0"/> 
                    <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase truncate">BG Motion</span>
                </div>
                <div className="flex items-baseline gap-1 mt-2 relative z-10">
                    <span className="text-2xl sm:text-3xl font-semibold tracking-tighter text-[#171717] tabular-nums">
                        {Math.max(peakMotionRef.current, motionMS2).toFixed(1)}
                    </span>
                    <span className="text-[10px] sm:text-xs font-medium text-[#737373]">m/s²</span>
                </div>
                {renderGraph(motionHistory, "#2563EB")}
              </div>
              
              <div className="bg-white p-4 sm:p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col justify-between overflow-hidden relative min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 text-[#737373] relative z-10">
                    <Mic size={14} strokeWidth={2.5} className="flex-shrink-0"/> 
                    <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase truncate">BG Audio</span>
                </div>
                <div className="flex items-baseline gap-1 mt-2 relative z-10">
                    <span className="text-2xl sm:text-3xl font-semibold tracking-tighter text-[#171717] tabular-nums">
                        {Math.max(peakAudioRef.current, audioDB).toFixed(0)}
                    </span>
                    <span className="text-[10px] sm:text-xs font-medium text-[#737373]">dB</span>
                </div>
                {renderGraph(audioHistory, "#DC2626")}
              </div>
            </div>

            {/* Configuration Module */}
            <div className="bg-white p-5 sm:p-6 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col gap-4 sm:gap-5">
                <div className="flex items-center gap-2 text-[#171717] font-medium text-sm border-b border-black/[0.06] pb-3">
                    <Settings2 size={16}/> Threshold Settings
                </div>
                
                <div className="flex justify-between items-center">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Motion Trigger</span>
                    <div className="flex items-center bg-[#F5F5F5] p-1 rounded-full">
                        <button onClick={() => setMotionThreshold(p => Math.max(2, p - 1))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Minus size={14}/></button>
                        <span className="w-8 sm:w-10 text-center font-medium text-sm sm:text-[15px] text-[#171717] tabular-nums">{motionThreshold}</span>
                        <button onClick={() => setMotionThreshold(p => Math.min(50, p + 1))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Plus size={14}/></button>
                    </div>
                </div>
                
                <div className="flex justify-between items-center">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-[#737373] uppercase tracking-widest">Audio Trigger</span>
                    <div className="flex items-center bg-[#F5F5F5] p-1 rounded-full">
                        <button onClick={() => setAudioThreshold(p => Math.max(10, p - 5))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Minus size={14}/></button>
                        <span className="w-8 sm:w-10 text-center font-medium text-sm sm:text-[15px] text-[#171717] tabular-nums">{audioThreshold}</span>
                        <button onClick={() => setAudioThreshold(p => Math.min(120, p + 5))} className="p-2 hover:bg-white rounded-full text-[#737373] transition-colors"><Plus size={14}/></button>
                    </div>
                </div>
            </div>

            {!sensorsActive && (
              <button 
                  onClick={enableSensors} 
                  className="w-full bg-[#171717] hover:bg-black text-white py-4 rounded-[20px] font-medium text-sm sm:text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all mt-2"
              >
                  Activate Background Monitoring
              </button>
            )}
          </div>

          {/* Sticky Bottom SOS Action */}
          <div className="mt-6 sm:mt-8 flex justify-center pb-2">
            <button 
                onClick={() => { setTriggerReason("MANUAL_FROM_SAFE"); handleTrapped("TRAPPED"); }} 
                className="w-full bg-[#171717] text-white py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-black transition-all"
            >
                <ShieldAlert size={16} className="sm:w-[18px] sm:h-[18px]" /> 
                <span className="font-medium text-sm sm:text-[15px] tracking-wide">Manual Override: I Am Trapped</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}