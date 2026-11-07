import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mic, ShieldAlert, CheckCircle, XCircle, Battery, Wifi, WifiOff, Pause, Play, AlertTriangle, Settings2, Minus, Plus, MapPin, Camera } from 'lucide-react';
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

  // UI Flow States
  const [isInitialized, setIsInitialized] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  
  // Timer States
  const [timeLeft, setTimeLeft] = useState(300);
  const [isAutoDeployPaused, setIsAutoDeployPaused] = useState(false);
  const [falseAlarmTimer, setFalseAlarmTimer] = useState(null);

  // Telemetry States
  const [audioDB, setAudioDB] = useState(0);
  const [motionMS2, setMotionMS2] = useState(0);
  
  const [motionHistory, setMotionHistory] = useState(Array(30).fill(0));
  const [audioHistory, setAudioHistory] = useState(Array(30).fill(0));
  
  const currentMotionRef = useRef(0);
  const currentAudioRef = useRef(0);
  const peakMotionRef = useRef(0);
  const peakAudioRef = useRef(0);
  const lastAccRef = useRef({ x: null, y: null, z: null });
  
  const [motionThreshold, setMotionThreshold] = useState(15);
  const [audioThreshold, setAudioThreshold] = useState(85);
  
  const [isBlackout, setIsBlackout] = useState(false);
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

  // Live Graph Animation Loop
  useEffect(() => {
    if (!isInitialized) return;
    const interval = setInterval(() => {
      const mVal = currentMotionRef.current;
      const motionY = Math.min((mVal / 50) * 100, 100); 

      const aVal = currentAudioRef.current;
      const audioY = Math.min((aVal / 120) * 100, 100);

      setMotionHistory(prev => [...prev.slice(1), motionY]);
      setAudioHistory(prev => [...prev.slice(1), audioY]);
    }, 100); 
    return () => clearInterval(interval);
  }, [isInitialized]);

  // Main 300s Auto-Deploy Timer (Pausable)
  useEffect(() => {
    if (!isInitialized || isBlackout || falseAlarmTimer !== null || isAutoDeployPaused || showPauseModal) return;
    const mainTimer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(mainTimer);
          handleTrapped(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(mainTimer);
  }, [isInitialized, isBlackout, falseAlarmTimer, isAutoDeployPaused, showPauseModal]);

  // Triggered SOS Countdown Timer (15s)
  useEffect(() => {
    if (falseAlarmTimer === null) return;
    const alarmTimer = setInterval(() => {
      setFalseAlarmTimer((prev) => {
        if (prev <= 1) {
          clearInterval(alarmTimer);
          handleTrapped(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(alarmTimer);
  }, [falseAlarmTimer]);

  useEffect(() => {
    if (navigator.getBattery) navigator.getBattery().then(b => setBatteryLvl(Math.round(b.level * 100)));
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
    if (isTrappedRef.current) return;
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;

    const { x, y, z } = acc;
    if (lastAccRef.current.x === null) {
        lastAccRef.current = { x, y, z };
        return;
    }

    const deltaX = Math.abs(x - lastAccRef.current.x);
    const deltaY = Math.abs(y - lastAccRef.current.y);
    const deltaZ = Math.abs(z - lastAccRef.current.z);

    let movement = deltaX + deltaY + deltaZ;
    lastAccRef.current = { x, y, z };
    if (movement < 0.5) movement = 0;

    currentMotionRef.current = movement;
    setMotionMS2(movement);

    if (isFalseAlarmRef.current && movement > peakMotionRef.current) {
        peakMotionRef.current = movement;
    }
    
    // Only trigger if we aren't already paused
    if (movement > motionThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current && !isAutoDeployPaused && !showPauseModal) {
      triggerFalseAlarm();
    }
  };

  // FIX: Hardware permissions MUST be requested synchronously directly inside the click event.
  const handleStartSequence = async () => {
    try {
      let motionGranted = false;
      
      // 1. Synchronous Motion Request
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const p = await DeviceMotionEvent.requestPermission();
        if (p === 'granted') motionGranted = true;
      } else {
        motionGranted = true; 
      }

      // 2. Synchronous Audio Context Wakeup
      if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
      }

      // 3. Synchronous Camera/Mic Request
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: { facingMode: { ideal: "environment" } } 
      });

      if (videoRef.current) { 
        videoRef.current.srcObject = stream; 
        await videoRef.current.play().catch(e => console.warn("Video play error:", e)); 
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
        
        if (currentDB > audioThreshRef.current && !isFalseAlarmRef.current && !isTrappedRef.current && sensorsActiveRef.current && !isAutoDeployPaused && !showPauseModal) {
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

      // 4. Activate Listeners
      if (motionGranted) {
        window.addEventListener('devicemotion', handleMotion);
      }
      sensorsActiveRef.current = true;
      setSensorsActive(true);

      // 5. Visual Fade Transition (Only triggers AFTER permissions are granted)
      setIsFading(true);
      setTimeout(() => {
          setIsInitialized(true);
          setIsFading(false);
      }, 400);

    } catch (err) {
      console.error("Hardware initialization failed:", err);
      alert("Permission denied or Hardware unavailable. Are you running this on a secure HTTPS connection?");
    }
  };

  const triggerFalseAlarm = () => {
    if (isFalseAlarmRef.current || isTrappedRef.current || !sensorsActiveRef.current) return;
    isFalseAlarmRef.current = true;
    setFalseAlarmTimer(15);
    setIsAutoDeployPaused(false); 
    
    peakMotionRef.current = currentMotionRef.current;
    peakAudioRef.current = currentAudioRef.current;
    
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
        const base64Str = canvas.toDataURL('image/jpeg', 0.3); 
        
        if (base64Str.length > 500 && !base64Str.endsWith("data:,")) {
            photoData = base64Str;
        }
      } catch (err) {
        console.warn("Canvas drawing failed:", err);
      }
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

    const payload = { 
        victimName: deviceId,
        status: "TRAPPED", 
        lat: locationRef.current.lat, 
        lng: locationRef.current.lng,
        battery: batteryLvl,
        packetType: isLowBandwidth ? "LOW_BANDWIDTH" : "HIGH_BANDWIDTH",
        timestamp: Date.now(),
        aiTriage: "Pending...",
        transcript: transcriptRef.current || "No words captured.",
        audioDB: (Math.max(peakAudioRef.current, audioDB)).toFixed(1),
        motionMS2: (Math.max(peakMotionRef.current, motionMS2)).toFixed(2),
        photoBase64: photoData || "", 
        audioRecordBase64: finalAudioBase64 || ""
    };

    try {
        await setDoc(doc(db, "victims", deviceId), payload, { merge: true });
    } catch (error) {
        console.error("Firebase Upload Failed:", error);
    }
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
      {/* FIX: Video Element is ALWAYS mounted at the root DOM level. It is never destroyed during screen swaps. */}
      <video 
        ref={videoRef} 
        playsInline 
        autoPlay 
        muted 
        onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
        style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 0.1, pointerEvents: 'none', zIndex: -10 }} 
      />

      {/* Screen 1: OPENING SEQUENCE */}
      {!isInitialized ? (
          <div className={`min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center p-4 sm:p-6 transition-opacity duration-700 ${isFading ? 'opacity-0' : 'opacity-100'} antialiased`} style={{ fontFamily: "'Inter', sans-serif" }}>
              <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
              
              <div className="w-full max-w-sm bg-white rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] p-6 sm:p-8 border border-black/[0.06] flex flex-col items-center text-center">
                  <div className="w-16 h-16 bg-[#171717] rounded-[16px] flex items-center justify-center mb-6 shadow-md">
                      <Activity className="text-white" size={32} strokeWidth={2}/>
                  </div>
                  
                  <h1 className="text-[#171717] text-2xl font-semibold tracking-tight mb-2">PulseTrack</h1>
                  <p className="text-[#737373] font-medium text-sm mb-8 leading-relaxed">
                      Enable background telemetry to secure your safety during emergencies.
                  </p>
                  
                  <div className="w-full flex flex-col gap-6 mb-10 text-left">
                      <div className="flex items-start gap-4">
                          <MapPin size={22} className="text-[#171717] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                          <div>
                              <h3 className="text-[#171717] font-medium text-[15px] tracking-tight">Precise Location</h3>
                              <p className="text-[#737373] text-[13px] mt-1 leading-relaxed">To broadcast your exact coordinates to responders if you are trapped.</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-4">
                          <Camera size={22} className="text-[#171717] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                          <div>
                              <h3 className="text-[#171717] font-medium text-[15px] tracking-tight">Camera Access</h3>
                              <p className="text-[#737373] text-[13px] mt-1 leading-relaxed">To securely capture visual context only during an active incident.</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-4">
                          <Mic size={22} className="text-[#171717] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                          <div>
                              <h3 className="text-[#171717] font-medium text-[15px] tracking-tight">Microphone</h3>
                              <p className="text-[#737373] text-[13px] mt-1 leading-relaxed">To analyze impact decibels and record emergency audio.</p>
                          </div>
                      </div>
                  </div>
                  
                  <button 
                      onClick={handleStartSequence} 
                      className="w-full bg-[#171717] hover:bg-black text-white py-3.5 px-6 rounded-full font-medium text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all"
                  >
                      Initialize System
                  </button>
              </div>
          </div>
      ) 
      
      /* Screen 2: BLACKOUT / SOS */
      : isBlackout ? (
        <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center items-center p-4 sm:p-6 antialiased" style={{ fontFamily: "'Inter', sans-serif" }}>
            <div className="bg-white p-8 sm:p-10 rounded-[24px] shadow-[0_2px_8px_rgba(220,38,38,0.1),0_16px_32px_rgba(220,38,38,0.1)] flex flex-col items-center w-full max-w-sm border border-red-100 relative overflow-hidden">
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
      ) 
      
      /* Screen 3: FALSE ALARM (15s) */
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
      
      /* Screen 4: MAIN DASHBOARD */
      : (
        <div className={`min-h-screen bg-[#FAFAFA] p-4 sm:p-6 flex flex-col transition-opacity duration-700 ${isFading ? 'opacity-0' : 'opacity-100'} relative antialiased`} style={{ fontFamily: "'Inter', sans-serif" }}>
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`}</style>
          
          {/* 300s Timer Pause Confirmation Modal */}
          {showPauseModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#000000]/20 backdrop-blur-sm">
                  <div className="bg-white rounded-[24px] p-6 sm:p-8 shadow-[0_16px_40px_rgba(0,0,0,0.12)] w-full max-w-sm border border-black/[0.04]">
                      <h2 className="text-xl font-semibold text-[#171717] tracking-tight mb-2">Pause Auto-Deploy?</h2>
                      <p className="text-sm text-[#737373] leading-relaxed mb-8">
                          The Command Center will not auto-deploy rescue services if the timer is paused. Ensure you are safe.
                      </p>
                      <div className="flex flex-col gap-3">
                          <button 
                              onClick={() => { setIsAutoDeployPaused(true); setShowPauseModal(false); }} 
                              className="w-full bg-[#F5F5F5] hover:bg-[#E5E5E5] text-[#171717] font-medium py-3.5 rounded-2xl transition-colors text-[15px]"
                          >
                              Confirm Pause
                          </button>
                          <button 
                              onClick={() => setShowPauseModal(false)} 
                              className="w-full bg-[#171717] hover:bg-black text-white font-medium py-3.5 rounded-2xl shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-colors text-[15px]"
                          >
                              Cancel
                          </button>
                      </div>
                  </div>
              </div>
          )}
          
          {/* Header */}
          <div className="flex justify-between items-center mb-6 sm:mb-8">
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#171717] rounded-lg flex items-center justify-center shadow-sm">
                    <Activity size={18} className="text-white" strokeWidth={2.5}/>
                </div>
                <h1 className="text-lg font-semibold tracking-tight text-[#171717]">PulseTrack</h1>
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
            
            {/* Main Auto-Deploy Timer Card */}
            <div className="bg-white p-6 sm:p-8 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col items-center justify-center relative">
                <div className="absolute top-4 sm:top-5 left-4 sm:left-5 flex items-center gap-2">
                    {isAutoDeployPaused ? (
                        <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-md bg-amber-50 text-amber-700">
                            Paused
                        </span>
                    ) : (
                        <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">
                            Monitoring
                        </span>
                    )}
                </div>

                <div className="mt-8 sm:mt-10 mb-2 sm:mb-4">
                    <div className={`text-5xl sm:text-6xl font-semibold tracking-tighter tabular-nums text-[#171717] transition-opacity duration-300 ${isAutoDeployPaused ? 'opacity-40' : 'opacity-100'}`}>
                        {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                    </div>
                </div>
                <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest text-[#A3A3A3] mb-6 sm:mb-8">
                    Auto-Deploy In
                </div>

                <div className="w-full flex gap-2 sm:gap-3">
                    <button 
                        onClick={() => navigate('/safe')} 
                        className="flex-1 bg-[#F5F5F5] hover:bg-[#E5E5E5] text-[#171717] py-3 sm:py-3.5 rounded-2xl flex justify-center items-center gap-2 font-medium text-sm sm:text-[15px] transition-colors"
                    >
                        <CheckCircle size={16} strokeWidth={2}/> Mark Safe
                    </button>
                    {isAutoDeployPaused ? (
                        <button 
                            onClick={() => setIsAutoDeployPaused(false)} 
                            className="flex-1 bg-[#171717] text-white py-3 sm:py-3.5 rounded-2xl flex justify-center items-center gap-2 font-medium text-sm sm:text-[15px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-colors"
                        >
                            <Play size={16} strokeWidth={2}/> Resume
                        </button>
                    ) : (
                        <button 
                            onClick={() => setShowPauseModal(true)} 
                            className="flex-1 bg-white border border-[#E5E5E5] hover:bg-[#F5F5F5] text-[#171717] py-3 sm:py-3.5 rounded-2xl flex justify-center items-center gap-2 font-medium text-sm sm:text-[15px] transition-colors"
                        >
                            <Pause size={16} strokeWidth={2}/> Pause
                        </button>
                    )}
                </div>
            </div>

            {/* Grid Layout (min-w-0 stops flexbox from overflowing offscreen on tiny mobiles) */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full">
              <div className="bg-white p-4 sm:p-5 rounded-[24px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_24px_rgba(0,0,0,0.02)] border border-black/[0.06] flex flex-col justify-between overflow-hidden relative min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 text-[#737373] relative z-10">
                    <Activity size={14} strokeWidth={2.5} className="flex-shrink-0"/> 
                    <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase truncate">Motion Peak</span>
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
                    <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest uppercase truncate">Audio Peak</span>
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

          </div>
          
          {/* Sticky Bottom SOS Action */}
          <div className="mt-6 sm:mt-8 flex justify-center pb-2">
            <button 
                onClick={() => handleTrapped(false)} 
                className="w-full bg-[#171717] text-white py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-black transition-all"
            >
              <ShieldAlert size={16} className="sm:w-[18px] sm:h-[18px]"/>
              <span className="font-medium text-sm sm:text-[15px] tracking-wide">Manual SOS Trigger</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}