import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, CheckCircle, Sliders, XCircle, Battery, Wifi, WifiOff, Minus, Plus } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore'; // Reverted to setDoc for targeted updating
import { db } from '../firebase';

export default function VictimUI() {
  // 1. GENERATE OR FETCH PERSISTENT DEVICE ID
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
  
  const [batteryLvl, setBatteryLvl] = useState(100);
  const [networkType, setNetworkType] = useState('4g');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const navigate = useNavigate();
  
  const locationRef = useRef({ lat: 12.9525, lng: 74.8806 });
  const isTrappedRef = useRef(false);
  const isFalseAlarmRef = useRef(false);
  const motionThreshRef = useRef(15);
  const audioThreshRef = useRef(85);
  const videoRef = useRef(null);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");

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
    if (navigator.getBattery) navigator.getBattery().then(b => setBatteryLvl(Math.round(b.level * 100)));
    if (navigator.connection) setNetworkType(navigator.connection.effectiveType);
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));

    enableSensors();

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }, 
      (err) => console.warn("GPS Warning:", err), 
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then((stream) => {
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      
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
        
        if (currentDB > audioThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current) {
          triggerFalseAlarm();
        }
        requestAnimationFrame(updateAudio);
      };
      updateAudio();
    }).catch(err => console.error("Media error:", err));

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
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleMotion = (event) => {
    if (event.accelerationIncludingGravity && !isTrappedRef.current) {
      const { x, y, z } = event.accelerationIncludingGravity;
      const movement = Math.abs(Math.sqrt(x*x + y*y + z*z) - 9.8); 
      setMotionMS2(movement);
      if (movement > motionThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current) {
        triggerFalseAlarm();
      }
    }
  };

  const enableSensors = async () => {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const p = await DeviceMotionEvent.requestPermission();
      if (p === 'granted') { window.addEventListener('devicemotion', handleMotion); setSensorsActive(true); }
    } else { window.addEventListener('devicemotion', handleMotion); setSensorsActive(true); }
  };

  const triggerFalseAlarm = () => {
    if (isFalseAlarmRef.current || isTrappedRef.current) return;
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
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
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
          canvas.width = 320; canvas.height = 240;
          canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 320, 240);
          photoData = canvas.toDataURL('image/jpeg', 0.5); 
        }
      } catch (err) {}
    }

    isTrappedRef.current = true;
    isFalseAlarmRef.current = false;
    setIsBlackout(true);
    setFalseAlarmTimer(null);

    if (!isAutoTrigger) {
        try {
            const audioCtx = new window.AudioContext();
            setInterval(() => {
                const osc = audioCtx.createOscillator();
                osc.frequency.setValueAtTime(3000, audioCtx.currentTime);
                osc.connect(audioCtx.destination);
                osc.start(); osc.stop(audioCtx.currentTime + 0.3);
            }, 2000);
        } catch(e) {}
    }

    const finalAudioBase64 = isLowBandwidth ? "" : await getProcessedAudio();

    // 2. USE setDoc WITH THE PERSISTENT deviceId TO OVERWRITE OLD DOTS
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
            transcript: transcriptRef.current || "No transcript available.",
            audioDB: audioDB.toFixed(1),
            motionMS2: motionMS2.toFixed(2)
        });
    } catch (error) {
        console.error("Firebase Upload Failed:", error);
    }
  };

  return (
    <>
      <video ref={videoRef} playsInline autoPlay muted className="hidden" />

      {isBlackout ? (
        <div className="min-h-screen bg-black flex flex-col justify-center items-center p-6 text-center">
            <ShieldAlert size={64} className="text-red-500 animate-pulse mb-4" />
            <h1 className="text-red-500 text-2xl font-bold">SURVIVAL MODE</h1>
            <p className="text-red-500/50">Incident payload delivered securely.</p>
        </div>
      ) : falseAlarmTimer !== null ? (
        <div className="min-h-screen bg-red-900/90 flex flex-col justify-center items-center p-6 text-center text-white z-50 fixed inset-0">
            <ShieldAlert size={80} className="text-white animate-bounce mb-6" />
            <h1 className="text-3xl font-bold mb-2">EMERGENCY TRIGGERED</h1>
            <p className="text-xl mb-2">Recording audio & transcribing...</p>
            <div className="text-8xl font-bold mb-12">{falseAlarmTimer}</div>
            <button onClick={cancelFalseAlarm} className="w-full bg-emerald-500 p-6 rounded-2xl flex justify-center items-center gap-3 text-xl font-bold">
                <XCircle size={32} /> I AM SAFE (CANCEL)
            </button>
        </div>
      ) : (
        <div className="min-h-screen bg-black p-6 flex flex-col font-sans">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-xl font-bold text-cyan-400">PULSE TRACK</h1>
            <div className="flex gap-3 text-xs font-mono items-center">
              <span className={`flex items-center gap-1 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
                {isOnline ? <Wifi size={14}/> : <WifiOff size={14}/>} {networkType.toUpperCase()}
              </span>
              <span className="text-emerald-400 flex items-center gap-1"><Battery size={14}/> {batteryLvl}%</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-4">
            <div className="bg-white/5 p-5 rounded-3xl border border-white/10 flex flex-col gap-5">
                <div className="flex justify-between items-center text-gray-400 font-bold">
                    <span className="flex items-center gap-2"><Activity size={18}/> MOTION (m/s²)</span>
                    <div className="flex items-center gap-3 bg-black rounded-lg border border-gray-800 p-1">
                        <button onClick={() => setMotionThreshold(p => Math.max(2, p - 1))} className="p-2 hover:bg-white/10 rounded text-cyan-400"><Minus size={16}/></button>
                        <span className="w-8 text-center text-cyan-400 font-mono text-lg">{motionThreshold}</span>
                        <button onClick={() => setMotionThreshold(p => Math.min(50, p + 1))} className="p-2 hover:bg-white/10 rounded text-cyan-400"><Plus size={16}/></button>
                    </div>
                </div>
                <div className="flex justify-between items-center text-gray-400 font-bold">
                    <span className="flex items-center gap-2"><Mic size={18}/> AUDIO (dB)</span>
                    <div className="flex items-center gap-3 bg-black rounded-lg border border-gray-800 p-1">
                        <button onClick={() => setAudioThreshold(p => Math.max(10, p - 5))} className="p-2 hover:bg-white/10 rounded text-blue-400"><Minus size={16}/></button>
                        <span className="w-8 text-center text-blue-400 font-mono text-lg">{audioThreshold}</span>
                        <button onClick={() => setAudioThreshold(p => Math.min(120, p + 5))} className="p-2 hover:bg-white/10 rounded text-blue-400"><Plus size={16}/></button>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-5 rounded-3xl border border-white/10 flex flex-col items-center justify-center gap-2">
                <Activity className="text-cyan-400" size={32} />
                <span className="text-gray-400 text-xs font-bold">LIVE MOTION</span>
                <span className="font-mono text-cyan-400 text-2xl">{motionMS2.toFixed(1)}</span>
              </div>
              <div className="bg-white/5 p-5 rounded-3xl border border-white/10 flex flex-col items-center justify-center gap-2">
                <Mic className="text-blue-400" size={32} />
                <span className="text-gray-400 text-xs font-bold">LIVE AUDIO</span>
                <span className="font-mono text-blue-400 text-2xl">{audioDB.toFixed(0)}</span>
              </div>
            </div>
            {!sensorsActive && (
              <button onClick={enableSensors} className="w-full bg-cyan-500/20 text-cyan-400 py-4 rounded-2xl font-bold tracking-widest border border-cyan-500/30">INITIALIZE SENSORS</button>
            )}
          </div>
          <div className="mt-4 flex flex-col items-center">
            <div className="text-6xl font-bold text-white mb-1">
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
            <p className="text-gray-400 text-sm mb-4 tracking-widest">AUTO-TRIGGER TIMER</p>
            <div className="w-full flex gap-4">
              <button onClick={() => navigate('/safe')} className="flex-1 bg-white/10 border border-emerald-500/50 p-4 rounded-2xl flex flex-col items-center gap-2">
                <CheckCircle className="text-emerald-400" size={28} />
                <span className="text-emerald-400 font-bold">I AM SAFE</span>
              </button>
              <button onClick={() => handleTrapped(false)} className="flex-1 bg-red-500/20 border border-red-500/50 p-4 rounded-2xl flex flex-col items-center gap-2">
                <ShieldAlert className="text-red-400" size={28} />
                <span className="text-red-400 font-bold">I AM TRAPPED</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}