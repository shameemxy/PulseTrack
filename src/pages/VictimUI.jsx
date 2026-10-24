import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, CheckCircle, XCircle, Battery, Wifi, WifiOff, Minus, Plus, Settings2 } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export default function VictimUI() {
  const [deviceId] = useState(() => {
    let id = localStorage.getItem("pulse_device_id");
    if (!id) {
      id = "Victim_" + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem("pulse_device_id", id);
    }
    return id;
  });

  const [timeLeft, setTimeLeft] = useState(300);
  const [audioDB, setAudioDB] = useState(0);
  const [motionMS2, setMotionMS2] = useState(0);
  
  const [motionThreshold, setMotionThreshold] = useState(15);
  const [audioThreshold, setAudioThreshold] = useState(85);
  
  const [isBlackout, setIsBlackout] = useState(false);
  const [falseAlarmTimer, setFalseAlarmTimer] = useState(null);
  const [sensorsActive, setSensorsActive] = useState(false);
  
  const [batteryLvl, setBatteryLvl] = useState(null); 
  const [networkType, setNetworkType] = useState('4g');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const audioCtxRef = useRef(null);

  useEffect(() => { motionThreshRef.current = motionThreshold; }, [motionThreshold]);
  useEffect(() => { audioThreshRef.current = audioThreshold; }, [audioThreshold]);

  useEffect(() => {
    if (timeLeft > 0 && !isBlackout && falseAlarmTimer === null) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0 && !isBlackout) {
      handleTrapped(true);
    }
  }, [timeLeft, isBlackout, falseAlarmTimer]);

  useEffect(() => {
    if (navigator.getBattery) {
      navigator.getBattery().then(b => setBatteryLvl(Math.round(b.level * 100)));
    }
    if (navigator.connection) setNetworkType(navigator.connection.effectiveType);
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }, 
      (err) => console.warn("GPS Warning:", err), 
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleMotion = (event) => {
    if (event.accelerationIncludingGravity && !isTrappedRef.current) {
      const { x, y, z } = event.accelerationIncludingGravity;
      const movement = Math.abs(Math.sqrt(x*x + y*y + z*z) - 9.8); 
      setMotionMS2(movement);
      
      if (movement > motionThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) {
        triggerFalseAlarm();
      }
    }
  };

  const enableSensors = async () => {
    sensorsActiveRef.current = true;
    setSensorsActive(true);

    let motionGranted = false;
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const p = await DeviceMotionEvent.requestPermission();
        if (p === 'granted') motionGranted = true;
      } catch (err) { console.warn("Motion permission denied", err); }
    } else {
      motionGranted = true; 
    }

    if (motionGranted) window.addEventListener('devicemotion', handleMotion);

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtxRef.current = new AudioContext();
    audioCtxRef.current.resume();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: { facingMode: { ideal: "environment" } } 
      });

      if (videoRef.current) { 
        videoRef.current.srcObject = stream; 
        videoRef.current.play(); 
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
        setAudioDB(currentDB);
        
        if (currentDB > audioThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current) {
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
      }
    } catch (err) {
      console.error("Camera/Mic initialization failed:", err);
    }
  };

  const triggerFalseAlarm = () => {
    if (isFalseAlarmRef.current || isTrappedRef.current || !sensorsActiveRef.current) return;
    
    isFalseAlarmRef.current = true;
    setFalseAlarmTimer(15);
    
    if (mediaRecorderRef.current?.state === "inactive") {
      audioChunksRef.current = [];
      mediaRecorderRef.current.start();
      try { recognitionRef.current?.start(); } catch(e) {}
    }
  };

  const cancelFalseAlarm = () => {
    isFalseAlarmRef.current = false;
    setFalseAlarmTimer(null);
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    try { recognitionRef.current?.stop(); } catch(e) {}
  };

  useEffect(() => {
    if (falseAlarmTimer !== null && falseAlarmTimer > 0) {
      const timer = setInterval(() => setFalseAlarmTimer(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (falseAlarmTimer === 0) {
        handleTrapped(true);
    }
  }, [falseAlarmTimer]);

  const getProcessedAudio = async () => {
    return new Promise((resolve) => {
      const safetyTimer = setTimeout(() => resolve(""), 1500);
      if (!mediaRecorderRef.current || audioChunksRef.current.length === 0) {
        clearTimeout(safetyTimer);
        return resolve("");
      }
      mediaRecorderRef.current.onstop = () => {
        clearTimeout(safetyTimer);
        if (audioChunksRef.current.length === 0) return resolve("");
        const mimeType = mediaRecorderRef.current.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      };
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      } else {
        mediaRecorderRef.current.onstop(); 
      }
    });
  };

  const handleTrapped = async (isAutoTrigger = false) => {
    if (isTrappedRef.current) return;
    try { recognitionRef.current?.stop(); } catch(e) {}

    const isLowBandwidth = networkType === '2g' || networkType === 'slow-2g' || !isOnline;
    let photoData = "";
    
    if (!isLowBandwidth && videoRef.current) {
      try {
        if (videoRef.current.readyState >= 2) {
          const canvas = document.createElement("canvas");
          const vw = videoRef.current.videoWidth;
          const vh = videoRef.current.videoHeight;
          canvas.width = 480; 
          canvas.height = 640;
          canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 480, 640);
          photoData = canvas.toDataURL('image/jpeg', 0.6); 
        }
      } catch (err) {}
    }

    isTrappedRef.current = true;
    isFalseAlarmRef.current = false;
    setIsBlackout(true);
    setFalseAlarmTimer(null);

    try {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        setInterval(() => {
            const osc = audioCtxRef.current.createOscillator();
            osc.frequency.setValueAtTime(3000, audioCtxRef.current.currentTime);
            osc.connect(audioCtxRef.current.destination);
            osc.start(); osc.stop(audioCtxRef.current.currentTime + 0.3);
        }, 2000);
    } catch(e) {}

    const finalAudioBase64 = isLowBandwidth ? "" : await getProcessedAudio();

    try {
        await setDoc(doc(db, "victims", deviceId), { 
            victimName: deviceId,
            status: "TRAPPED", 
            lat: locationRef.current.lat, 
            lng: locationRef.current.lng,
            battery: batteryLvl,
            packetType: isLowBandwidth ? "LOW_BANDWIDTH" : "HIGH_BANDWIDTH",
            timestamp: Date.now(),
            aiTriage: "Pending...",
            photoBase64: photoData,
            audioRecordBase64: finalAudioBase64,
            transcript: transcriptRef.current || "No words captured.",
            audioDB: audioDB.toFixed(1),
            motionMS2: motionMS2.toFixed(2)
        });
    } catch (error) {
        console.error("Firebase Upload Failed:", error);
    }
  };

  // 1. SURVIVAL MODE UI (Clean & Stark)
  if (isBlackout) return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6 text-center">
        <ShieldAlert size={64} className="text-red-600 mb-4" />
        <h1 className="text-slate-900 text-2xl font-bold uppercase tracking-wide">Emergency Beacon Active</h1>
        <p className="text-slate-500 font-medium mt-2">Command Center has been notified.</p>
    </div>
  );

  // 2. FALSE ALARM TRIGGER UI (High Contrast)
  if (falseAlarmTimer !== null) return (
    <div className="min-h-screen bg-red-600 flex flex-col justify-center items-center p-6 text-center text-white z-50 fixed inset-0">
        <ShieldAlert size={80} className="text-white animate-pulse mb-6" />
        <h1 className="text-3xl font-bold mb-2 uppercase tracking-wider">Critical Event Detected</h1>
        <p className="text-red-100 mb-2 font-medium">Recording telemetry...</p>
        <div className="text-8xl font-bold mb-12 tabular-nums">{falseAlarmTimer}</div>
        <button onClick={cancelFalseAlarm} className="w-full bg-white text-red-600 p-5 rounded-lg shadow-lg flex justify-center items-center gap-3 text-lg font-bold uppercase tracking-wide hover:bg-slate-50 transition">
            <XCircle size={28} /> Cancel Alarm (Safe)
        </button>
    </div>
  );

  // 3. MAIN ENTERPRISE UI
  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col font-sans text-slate-900">
      <video ref={videoRef} playsInline autoPlay muted className="hidden" />
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
            <img src="/logo-transparent.png" alt="Logo" className="w-6 h-6 object-contain" onError={(e) => e.target.style.display='none'} />
            <h1 className="text-lg font-bold tracking-tight">PULSETRACK</h1>
        </div>
        <div className="flex gap-4 text-xs font-semibold text-slate-500 items-center">
          <span className={`flex items-center gap-1 ${isOnline ? 'text-blue-600' : 'text-red-600'}`}>
            {isOnline ? <Wifi size={14} strokeWidth={2.5}/> : <WifiOff size={14} strokeWidth={2.5}/>} {networkType.toUpperCase()}
          </span>
          {batteryLvl !== null && (
            <span className="flex items-center gap-1 text-slate-600"><Battery size={14} strokeWidth={2.5}/> {batteryLvl}%</span>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-6">
        
        {/* Telemetry Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Activity size={14} strokeWidth={2.5}/> <span className="text-[10px] font-bold tracking-widest uppercase">Motion</span></div>
            <div className="flex items-baseline gap-1">
                <span className="font-mono text-3xl font-bold tracking-tight">{motionMS2.toFixed(1)}</span>
                <span className="text-xs text-slate-400 font-medium">m/s²</span>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Mic size={14} strokeWidth={2.5}/> <span className="text-[10px] font-bold tracking-widest uppercase">Audio</span></div>
            <div className="flex items-baseline gap-1">
                <span className="font-mono text-3xl font-bold tracking-tight">{audioDB.toFixed(0)}</span>
                <span className="text-xs text-slate-400 font-medium">dB</span>
            </div>
          </div>
        </div>

        {/* RESTORED THRESHOLD CONTROLS (shadcn style) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
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

        {!sensorsActive ? (
          <button onClick={enableSensors} className="w-full bg-slate-900 hover:bg-slate-800 text-slate-50 py-3.5 rounded-xl font-semibold shadow-md transition flex items-center justify-center gap-2">
            Initialize Tracking Sensors
          </button>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-3.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
            <CheckCircle size={18}/> Sensors Online & Monitoring
          </div>
        )}
      </div>
      
      {/* Actions */}
      <div className="mt-8 flex flex-col items-center">
        <div className="text-slate-400 text-[10px] font-bold tracking-widest mb-1 uppercase">Auto-Deploy Timer</div>
        <div className="text-5xl font-extrabold text-slate-800 mb-6 tabular-nums tracking-tighter">
            {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
        </div>
        
        <div className="w-full flex gap-3">
          <button onClick={() => navigate('/safe')} className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 p-4 rounded-xl flex flex-col items-center gap-2 shadow-sm transition">
            <CheckCircle size={22} strokeWidth={2}/>
            <span className="font-semibold text-sm">Mark Safe</span>
          </button>
          <button onClick={() => handleTrapped(false)} className="flex-1 bg-red-600 hover:bg-red-700 text-white shadow-md p-4 rounded-xl flex flex-col items-center gap-2 transition">
            <ShieldAlert size={22} strokeWidth={2}/>
            <span className="font-semibold text-sm uppercase tracking-wide">SOS Override</span>
          </button>
        </div>
      </div>
    </div>
  );
}