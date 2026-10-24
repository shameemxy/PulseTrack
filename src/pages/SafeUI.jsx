import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, Sliders, XCircle, Battery, Wifi, WifiOff, Minus, Plus, AlertTriangle } from 'lucide-react';
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore'; 
import { db } from '../firebase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const distressIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

export default function SafeUI() {
  const [deviceId] = useState(() => {
    let id = localStorage.getItem("pulse_device_id");
    if (!id) {
      id = "Victim_" + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem("pulse_device_id", id);
    }
    return id;
  });

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
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");

  useEffect(() => { motionThreshRef.current = motionThreshold; }, [motionThreshold]);
  useEffect(() => { audioThreshRef.current = audioThreshold; }, [audioThreshold]);

  useEffect(() => {
    const q = query(collection(db, "victims"), where("status", "==", "TRAPPED"));
    const unsubscribeMap = onSnapshot(q, (snapshot) => {
      setTrappedCitizens(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

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

    return () => {
        unsubscribeMap();
        navigator.geolocation.clearWatch(watchId);
    };
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

    if (motionGranted) {
      window.addEventListener('devicemotion', handleMotion);
    }

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

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
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
      console.warn("Sensor initialization failed:", err);
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
        handleTrapped(); 
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

  const handleTrapped = async () => {
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
          canvas.width = vw;
          canvas.height = vh;
          canvas.getContext('2d').drawImage(videoRef.current, 0, 0, vw, vh);
          photoData = canvas.toDataURL('image/jpeg', 0.6); 
        }
      } catch (err) {}
    }

    isTrappedRef.current = true;
    isFalseAlarmRef.current = false;
    setIsBlackout(true);
    setFalseAlarmTimer(null);

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
        console.error("Upload Failed:", error);
    }
  };

  return (
    <>
      <video ref={videoRef} playsInline autoPlay muted className="hidden" />

      {isBlackout ? (
        <div className="min-h-screen bg-black flex flex-col justify-center items-center p-6 text-center">
            <ShieldAlert size={64} className="text-red-500 animate-pulse mb-4" />
            <h1 className="text-red-500 text-2xl font-bold">EMERGENCY STATE</h1>
            <p className="text-red-500/50">You have been marked as TRAPPED. Command alerted.</p>
        </div>
      ) : falseAlarmTimer !== null ? (
        <div className="min-h-screen bg-red-900/90 flex flex-col justify-center items-center p-6 text-center text-white z-50 fixed inset-0">
            <ShieldAlert size={80} className="text-white animate-bounce mb-6" />
            <h1 className="text-3xl font-bold mb-2">SECONDARY EVENT DETECTED</h1>
            <p className="text-xl mb-2">Recording audio & transcribing...</p>
            <div className="text-8xl font-bold mb-12">{falseAlarmTimer}</div>
            <button onClick={cancelFalseAlarm} className="w-full bg-emerald-500 p-6 rounded-2xl flex justify-center items-center gap-3 text-xl font-bold">
                <XCircle size={32} /> I AM STILL SAFE
            </button>
        </div>
      ) : (
        <div className="min-h-screen bg-black p-6 flex flex-col font-sans">
          
          <div className="flex justify-between items-center mb-4">
            <div className="flex flex-col">
                <h1 className="text-xl font-bold text-emerald-400 flex items-center gap-2">STATUS: SAFE</h1>
                <span className="text-gray-400 text-xs">Responder Mode Active</span>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs font-mono">
              <span className={`flex items-center gap-1 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
                {isOnline ? <Wifi size={14}/> : <WifiOff size={14}/>} {networkType.toUpperCase()}
              </span>
              {batteryLvl !== null && (
                <span className="text-emerald-400 flex items-center gap-1"><Battery size={14}/> {batteryLvl}%</span>
              )}
            </div>
          </div>

          <div className="flex-none h-[300px] rounded-3xl overflow-hidden border border-emerald-500/30 mb-4 relative z-0">
            <div className="absolute top-2 left-2 z-[400] bg-black/80 px-3 py-1 rounded-full border border-red-500/50 text-[10px] text-red-400 font-bold flex items-center gap-1 animate-pulse">
                <AlertTriangle size={12}/> {trappedCitizens.length} NEARBY INCIDENTS
            </div>
            <MapContainer center={[12.9525, 74.8806]} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {trappedCitizens.map((user) => (
                user.lat && user.lng ? (
                  <Marker key={user.id} position={[user.lat, user.lng]} icon={distressIcon}>
                    <Popup><b>{user.victimName || user.id}</b></Popup>
                  </Marker>
                ) : null
              ))}
            </MapContainer>
          </div>

          <div className="flex-1 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex flex-col items-center gap-2">
                <span className="text-gray-400 text-[10px] font-bold">MOTION BACKGROUND</span>
                <span className="font-mono text-emerald-400 text-xl">{motionMS2.toFixed(1)} <span className="text-xs">m/s²</span></span>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex flex-col items-center gap-2">
                <span className="text-gray-400 text-[10px] font-bold">AUDIO BACKGROUND</span>
                <span className="font-mono text-emerald-400 text-xl">{audioDB.toFixed(0)} <span className="text-xs">dB</span></span>
              </div>
            </div>

            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-400">MOTION TRIGGER</span>
                    <div className="flex items-center gap-2 bg-black rounded p-1">
                        <button onClick={() => setMotionThreshold(p => Math.max(2, p - 1))} className="p-1 text-emerald-400"><Minus size={14}/></button>
                        <span className="text-emerald-400 font-mono text-sm w-6 text-center">{motionThreshold}</span>
                        <button onClick={() => setMotionThreshold(p => Math.min(50, p + 1))} className="p-1 text-emerald-400"><Plus size={14}/></button>
                    </div>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-400">AUDIO TRIGGER</span>
                    <div className="flex items-center gap-2 bg-black rounded p-1">
                        <button onClick={() => setAudioThreshold(p => Math.max(10, p - 5))} className="p-1 text-emerald-400"><Minus size={14}/></button>
                        <span className="text-emerald-400 font-mono text-sm w-6 text-center">{audioThreshold}</span>
                        <button onClick={() => setAudioThreshold(p => Math.min(120, p + 5))} className="p-1 text-emerald-400"><Plus size={14}/></button>
                    </div>
                </div>
            </div>

            {!sensorsActive && (
              <button onClick={enableSensors} className="w-full bg-emerald-500/20 text-emerald-400 py-3 rounded-xl font-bold border border-emerald-500/30 text-sm">ACTIVATE BACKGROUND SENSORS</button>
            )}
          </div>

          <div className="mt-4">
            <button onClick={() => handleTrapped()} className="w-full bg-red-500/20 border border-red-500/50 p-4 rounded-2xl flex justify-center items-center gap-2">
                <ShieldAlert className="text-red-400" size={20} />
                <span className="text-red-400 font-bold">MANUAL OVERRIDE: I AM TRAPPED</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}