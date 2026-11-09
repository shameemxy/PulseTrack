import { useState, useRef, useEffect, useCallback } from 'react';

export function useTelemetry(motionThreshold, audioThreshold, onTrigger) {
  const [motionMS2, setMotionMS2] = useState(0);
  const [audioDB, setAudioDB] = useState(0);
  
  const peakMotionRef = useRef(0);
  const peakAudioRef = useRef(0);
  
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const animationRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  
  const videoRef = useRef(null);
  const lastAccRef = useRef({ x: null, y: null, z: null });
  const isTriggeredRef = useRef(false);

  // Consolidated cleanup function to prevent background zombie sensors
  const stopSensors = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
    try { recognitionRef.current?.stop(); } catch(e) {}
    
    window.removeEventListener('devicemotion', handleMotion);
  }, []);

  // Guarantee cleanup on component unmount
  useEffect(() => {
    return () => stopSensors();
  }, [stopSensors]);

  const handleMotion = useCallback((event) => {
    if (isTriggeredRef.current) return;
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;

    let movement = 0;
    if (event.acceleration) {
      // Linear acceleration delta
      const { x, y, z } = acc;
      if (lastAccRef.current.x !== null) {
        movement = Math.abs(x - lastAccRef.current.x) + Math.abs(y - lastAccRef.current.y) + Math.abs(z - lastAccRef.current.z);
      }
      lastAccRef.current = { x, y, z };
    } else {
      // Fallback for devices only providing gravity-included acceleration
      const { x, y, z } = acc;
      movement = Math.abs(Math.sqrt(x*x + y*y + z*z) - 9.8);
    }

    if (movement < 0.5) movement = 0;
    setMotionMS2(movement);

    if (movement > peakMotionRef.current) peakMotionRef.current = movement;
    if (movement > motionThreshold) onTrigger("IMPACT");
  }, [motionThreshold, onTrigger]);

  const startSensors = async () => {
    try {
      let motionGranted = false;
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const p = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
        if (p === 'granted') motionGranted = true;
      } else {
        motionGranted = true;
      }

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => console.warn("Video play error:", e));
      }

      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };

      const analyser = audioCtxRef.current.createAnalyser();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const currentDB = Math.max(0, (avg / 255) * 120);
        
        setAudioDB(currentDB);
        if (currentDB > peakAudioRef.current) peakAudioRef.current = currentDB;
        if (currentDB > audioThreshold) onTrigger("LOUD_SOUND");
        
        animationRef.current = requestAnimationFrame(updateAudio);
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

      if (motionGranted) window.addEventListener('devicemotion', handleMotion);
      return true;

    } catch (err) {
      console.error("Sensor init failed:", err);
      return false;
    }
  };

  const getMediaPayload = async () => {
    isTriggeredRef.current = true;
    let photoData = "";
    let audioData = "";

    // 1. Capture Image
    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const video = videoRef.current;
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 240;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 320, 240);
        const base64Str = canvas.toDataURL('image/jpeg', 0.3);
        if (base64Str.length > 500) photoData = base64Str;
      } catch (err) { console.warn("Photo fail:", err); }
    }

    // 2. Capture Audio
    audioData = await new Promise((resolve) => {
      const safetyTimer = setTimeout(() => resolve(""), 1500);
      if (!mediaRecorderRef.current || audioChunksRef.current.length === 0) {
        clearTimeout(safetyTimer); return resolve("");
      }
      mediaRecorderRef.current.onstop = () => {
        clearTimeout(safetyTimer);
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      };
      if (mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
      else mediaRecorderRef.current.onstop();
    });

    return { photoData, audioData, transcript: transcriptRef.current };
  };

  return {
    videoRef,
    startSensors,
    stopSensors,
    motionMS2,
    audioDB,
    peakMotion: peakMotionRef.current,
    peakAudio: peakAudioRef.current,
    getMediaPayload
  };
}