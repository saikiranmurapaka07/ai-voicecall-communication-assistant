import React, {useEffect, useRef, useState} from "react";
import {Peer} from "peerjs";
import {FaceLandmarker, FilesetResolver} from "@mediapipe/tasks-vision";
import "./keyboard.css";

const API="http://192.168.1.5:8000";
const PHRASES=["Hello","Yes","No","I need help","Please wait","I am feeling sick","I want to go home","Thank you"];
const MODES=["Normal","Calm","Polite","Urgent","Professional"];

export default function App(){
  const [page,setPage]=useState("home");
  const [text,setText]=useState("");
  const [improved,setImproved]=useState("");
  const [suggestions,setSuggestions]=useState([]);
  const [tone,setTone]=useState("Friendly");
  const [language,setLanguage]=useState("English");
  const [aiOriginal,setAiOriginal]=useState("");
  const [aiTranslated,setAiTranslated]=useState("");
  const [aiRespLanguage,setAiRespLanguage]=useState("");
  const [voices,setVoices]=useState([]);
  const [selectedVoiceURI,setSelectedVoiceURI]=useState("");
  const [voiceAvailable,setVoiceAvailable]=useState(true);
  const [rate,setRate]=useState(1);
  const [pitch,setPitch]=useState(1);
  const [volume,setVolume]=useState(1);
  const [status,setStatus]=useState("");
  const [ttsState,setTtsState]=useState("Ready");
  const [busy,setBusy]=useState(false);
  const [ttsSource,setTtsSource]=useState('Browser');
  const [selected,setSelected]=useState(0);
  const [gazeOn,setGazeOn]=useState(false);
  const [callPeerId,setCallPeerId]=useState("");
  const [remoteId,setRemoteId]=useState("");
  const [callStatus,setCallStatus]=useState("Not connected");
  const [incoming,setIncoming]=useState(false);
  const [incomingCall,setIncomingCall]=useState(null);
  const [composed,setComposed]=useState("");
  const [hoveredKey,setHoveredKey]=useState(null); // {row,col,key}
  const hoveredKeyRef=useRef(null);
  const keyboardRef=useRef(null);
  const keysPosRef=useRef([]);
  const [faceDetected,setFaceDetected]=useState(false);
  const [gazeDirection,setGazeDirection]=useState("CENTER");
  const [blinkState,setBlinkState]=useState("OPEN");
  const [selectionState,setSelectionState]=useState("READY");
  const [calibrationState,setCalibrationState]=useState("NOT CALIBRATED");
  const calibrationRef=useRef({center:null,left:null,right:null,up:null,down:null});
  const [calibrating,setCalibrating]=useState(false);
  const [calibStep,setCalibStep]=useState(0);
  const CALIB_STEPS=['center','left','right','up','down'];

  const videoRef=useRef(null), canvasRef=useRef(null), landmarkerRef=useRef(null), rafRef=useRef(null);
  const gazeIndexRef=useRef(0), blinkStartRef=useRef(null), lastMoveRef=useRef(0);
  const peerRef=useRef(null), callRef=useRef(null), micRef=useRef(null);
  const incomingCallRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  // Audio mixer refs (reuse existing ctxRef/destRef where appropriate)
  const ctxRef=useRef(null), destRef=useRef(null), sourcesRef=useRef(new Set());
  const audioContextRef = ctxRef; // alias for requested name
  const micSourceRef = useRef(null);
  const micGainRef = useRef(null);
  const aiGainRef = useRef(null);
  const mixerDestinationRef = destRef; // alias
  const mixedStreamRef = useRef(null);
  const micStreamRef = localStreamRef; // alias
  const remoteAudioRef=useRef(null);
  const utteranceRef=useRef(null);
  const hoverStableRef=useRef({key:null, since:0});
  const gazeRawRef=useRef({x:0,y:0});
  const gazeNormRef=useRef({x:0,y:0});
  const smoothGazeRef=useRef({x:0,y:0});
  const [gazeCursor,setGazeCursor]=useState({x:0,y:0,visible:false});
  const [gazeStable,setGazeStable]=useState(false);
  const [blinkDuration,setBlinkDuration]=useState(0);
  const [longBlinkFlag,setLongBlinkFlag]=useState(false);
  const [gazeDebugVisible,setGazeDebugVisible]=useState(false);
  const [eyesDetected,setEyesDetected]=useState({left:false,right:false});
  const BLINK_SELECT_MS = 700; // selection threshold (ms)
  const BLINK_NORMAL_MS = 400; // typical blink upper bound
  const SELECTION_DEBOUNCE_MS = 900; // prevent multiple selections from one long blink
  const lastSelectionRef = useRef(0);

  useEffect(()=>{ gazeIndexRef.current=selected; },[selected]);

  useEffect(()=>{
    // Load available voices and watch for changes
    function loadVoices(){
      if(!('speechSynthesis' in window)) return setVoices([]);
      const v=window.speechSynthesis.getVoices()||[];
      setVoices(v);
      // If no voice already selected, pick best for current language
      if(!selectedVoiceURI){
        const best=getBestVoice(language);
        if(best) setSelectedVoiceURI(best.voiceURI);
      }
    }
    loadVoices();
    if('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged=loadVoices;
    return ()=>{ if('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged=null };
  },[]);

  useEffect(()=>{
    // When language changes, select best voice and set availability flag
    const best=getBestVoice(language);
    if(best){ setSelectedVoiceURI(best.voiceURI); setVoiceAvailable(true); }
    else { setVoiceAvailable(false); }
  },[language,voices]);

  function pickVoiceForLanguage(langLabel, voiceList){
    // map label to lang code
    const map={English:'en',Hindi:'hi',Telugu:'te'};
    const code=map[langLabel]||'en';
    if(!voiceList||voiceList.length===0) return null;
    // prefer exact startsWith code, then contains
    let found=voiceList.find(v=>v.lang && v.lang.toLowerCase().startsWith(code));
    if(found) return found;
    found=voiceList.find(v=>v.name && v.name.toLowerCase().includes(code));
    if(found) return found;
    return null;
  }

  // Dev Test: create an oscillator and inject through aiGain -> mixerDestination (no new destination)
  async function testRemoteAudio(){
    try{
      if(!callRef.current){ setStatus('No active call'); return; }
      if(!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ac = audioContextRef.current;
      console.log('[WEBRTC] AudioContext state:', ac.state);
      if(ac.state === 'suspended') await ac.resume();

      // Ensure mixer destination exists (do NOT create a new destination)
      const mixerDest = mixerDestinationRef.current;
      if(!mixerDest){ throw new Error('Mixer destination not initialized. Start or prepare call audio first.'); }

      // Ensure aiGain is present and connected to mixer destination (do not create new destination)
      if(!aiGainRef.current){ aiGainRef.current = ac.createGain(); aiGainRef.current.gain.value = 0.7; aiGainRef.current.connect(mixerDest); console.log('[WEBRTC] aiGain created and connected to mixerDestination'); }
      else {
        try{ aiGainRef.current.connect(mixerDest); }catch(_){ /* ignore if already connected */ }
        console.log('[WEBRTC] aiGain present; gain value:', aiGainRef.current.gain.value);
      }

      // Create oscillator -> testGain -> aiGain -> mixerDestination
      const osc = ac.createOscillator();
      const testGain = ac.createGain(); testGain.gain.value = 0.2;
      osc.type = 'sine'; osc.frequency.value = 440;
      osc.connect(testGain);
      testGain.connect(aiGainRef.current);
      // Also route locally so caller hears it
      try{ testGain.connect(ac.destination); }catch(_){ }

      // Log destination tracks and mixer state
      try{
        console.log('[WEBRTC] destination tracks:', mixerDest.stream.getAudioTracks());
        const mt = mixedStreamRef.current?.getAudioTracks?.() || mixerDest.stream.getAudioTracks();
        console.log('[WEBRTC] mixedStream track id', mt[0]?.id);
      }catch(_){ }

      // Start oscillator
      osc.start(); console.log('[WEBRTC] test oscillator started -> aiGain -> mixer'); setStatus('Test tone playing for 1s');

      // After starting, verify sender uses mixed track and replace if necessary
      try{
        const mixedTrack = mixerDest.stream.getAudioTracks()[0];
        console.log('[WEBRTC] MIXED TRACK ID:', mixedTrack?.id);
        console.log('[WEBRTC] aiGain:', aiGainRef.current.gain.value);
        const call = callRef.current;
        const pc = call?.peerConnection;
        if(!pc) console.warn('[WEBRTC] No peerConnection found yet');
        else {
          const senders = pc.getSenders ? pc.getSenders() : [];
          const audioSender = senders.find(s=>s && s.track && s.track.kind === 'audio');
          console.log('[WEBRTC] AUDIO SENDER TRACK', audioSender?.track);
          console.log('[WEBRTC] SENDER TRACK ID', audioSender?.track?.id);
          console.log('[WEBRTC] MIXED TRACK ID', mixedTrack?.id);
          if(audioSender && audioSender.track?.id !== mixedTrack?.id){
            if(typeof audioSender.replaceTrack === 'function'){
              await audioSender.replaceTrack(mixedTrack);
              console.log('[WEBRTC] replaced sender.track with mixedTrack');
              console.log('[WEBRTC] SENDER TRACK ID', audioSender?.track?.id);
            } else {
              console.warn('[WEBRTC] replaceTrack not supported');
            }
          }
        }
      }catch(err){ console.error('[WEBRTC] sender verify error', err); }

      setTimeout(()=>{ try{ osc.stop(); osc.disconnect(); testGain.disconnect(); console.log('[WEBRTC] test oscillator stopped'); setStatus('Test tone finished'); }catch(_){ } }, 1000);
    }catch(err){ console.error('testRemoteAudio error', err); setStatus('Test failed: '+String(err)); }
  }

  function selectBrowserVoice(langLabel){
    // Return {voice, reason}
    const map={English:'en',Hindi:'hi',Telugu:'te'};
    const code = map[langLabel] || (typeof langLabel==='string' && langLabel.slice(0,2).toLowerCase()) || 'en';
    if(!voices || voices.length===0) return {voice:null,reason:null};
    // 1) selectedVoiceURI if matches requested language
    if(selectedVoiceURI){
      const sv = voices.find(v=>v.voiceURI===selectedVoiceURI);
      if(sv && sv.lang && sv.lang.toLowerCase().startsWith(code)) return {voice:sv,reason:'selected'};
    }
    // 2) exact regional voice
    const preferred = code==='hi' ? 'hi-IN' : code==='te' ? 'te-IN' : code==='en' ? 'en-IN' : null;
    if(preferred){
      const byPref = voices.find(v=>v.lang && v.lang.toLowerCase()===preferred.toLowerCase());
      if(byPref) return {voice:byPref,reason:'regional'};
    }
    // 3) any voice beginning with code
    const byStart = voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(code));
    if(byStart) return {voice:byStart,reason:'lang-starts-with'};
    return {voice:null,reason:null};
  }

  // Preferred voice selection per requirements
  function getBestVoice(target){
    // accept 'hi'|'Hindi'|'Hindi-IN' or 'te'|'Telugu' or 'en'|'English'
    const map={English:'en',Hindi:'hi',Telugu:'te','en':'en','hi':'hi','te':'te'};
    const code = map[target] || (typeof target==='string' && target.slice(0,2).toLowerCase()) || 'en';
    if(!voices || voices.length===0) return null;
    // prefer specific regional codes
    const preferred = code==='hi' ? 'hi-IN' : code==='te' ? 'te-IN' : code==='en' ? 'en-IN' : null;
    if(preferred){
      const byPref = voices.find(v=>v.lang && v.lang.toLowerCase()===preferred.toLowerCase());
      if(byPref) return byPref;
    }
    // then prefer any voice whose lang starts with the code
    const byStart = voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(code));
    if(byStart) return byStart;
    // lastly prefer name contains code
    const byName = voices.find(v=>v.name && v.name.toLowerCase().includes(code));
    if(byName) return byName;
    return null;
  }

  // Recompute key positions on layout changes
  function updateKeyPositions(){
    const keys = [];
    if(!keyboardRef.current) return keysPosRef.current = keys;
    const els = keyboardRef.current.querySelectorAll('[data-key]');
    els.forEach(el=>{
      const r = el.getBoundingClientRect();
      keys.push({key:el.getAttribute('data-key'), cx: r.left + r.width/2, cy: r.top + r.height/2, el});
    });
    keysPosRef.current = keys;
    return keys;
  }

  useEffect(()=>{ window.addEventListener('resize', updateKeyPositions); return ()=>window.removeEventListener('resize', updateKeyPositions); },[]);

  // Microphone helper per requirements
  async function getMicrophoneStream(){
    if(!navigator.mediaDevices) {
      const msg = 'MICROPHONE_API_UNAVAILABLE: navigator.mediaDevices is unavailable. Open the application using HTTPS.';
      const err = new Error(msg); err.name = 'MICROPHONE_API_UNAVAILABLE';
      throw err;
    }
    if(!navigator.mediaDevices.getUserMedia){
      const msg = 'GET_USER_MEDIA_UNAVAILABLE: getUserMedia is unavailable. Open the application using HTTPS.';
      const err = new Error(msg); err.name = 'GET_USER_MEDIA_UNAVAILABLE';
      throw err;
    }
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  // Camera helper for gaze (keeps video path separate)
  async function getCameraStream(){
    if(!navigator.mediaDevices) {
      const msg = 'CAMERA_API_UNAVAILABLE: navigator.mediaDevices is unavailable. Open the application using HTTPS.';
      const err = new Error(msg); err.name = 'CAMERA_API_UNAVAILABLE';
      throw err;
    }
    if(!navigator.mediaDevices.getUserMedia){
      const msg = 'GET_USER_MEDIA_UNAVAILABLE: getUserMedia is unavailable. Open the application using HTTPS.';
      const err = new Error(msg); err.name = 'GET_USER_MEDIA_UNAVAILABLE';
      throw err;
    }
    return await navigator.mediaDevices.getUserMedia({video:true});
  }

  async function aiAction(action){
    const source=text.trim() || improved.trim();
    if(!source){setStatus("Enter or select a message first.");return;}
    setBusy(true); setStatus("AI is processing...");
    try{
      const r=await fetch(API+"/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},
        // include tone and language so AI can adapt style
        body:JSON.stringify({text:source,action,tone,language})});
      if(!r.ok) throw Error("AI request failed");
      const d=await r.json();
      // server returns structured object: original, language (code), translated, improved, suggestions
      setAiOriginal(d.original || source);
      setAiRespLanguage(d.language || (language==="English"?"en":(language==="Hindi"?"hi":"te")));
      setAiTranslated(d.translated || (d.improved || source));
      setImproved(d.improved || source);
      setSuggestions(d.suggestions || []);
      setStatus("AI suggestions ready.");
    }catch(e){
      // If translate action requested, try local translate fallback so Translate button works without OpenAI
      if(action === 'translate'){
        const resp = await translateText(source, language);
        if(resp && resp.translated){
          setAiOriginal(source);
          setAiTranslated(resp.translated);
          setAiRespLanguage(resp.source === 'local' ? (language === 'Hindi' ? 'hi' : (language === 'Telugu' ? 'te' : 'en')) : (language === 'Hindi' ? 'hi' : (language === 'Telugu' ? 'te' : 'en')));
          setImproved(resp.translated);
          setSuggestions([]);
          setStatus(resp.source === 'local' ? 'Using local translation' : 'Translation ready');
        } else {
          setStatus('Translation unavailable.');
        }
      } else {
        setStatus("AI unavailable. Add OPENAI_API_KEY in backend/.env.");
      }
    }
    finally{setBusy(false);}
  }

  async function translateText(original, targetLabel){
    const localMap = {
      "i need some water": {Hindi:'मुझे थोड़ा पानी चाहिए।', Telugu:'నాకు కొంచెం నీరు కావాలి.'},
      "i need help": {Hindi:'मुझे मदद चाहिए।', Telugu:'నాకు సహాయం కావాలి.'},
      "please wait": {Hindi:'कृपया प्रतीक्षा करें।', Telugu:'దయచేసి వేచి ఉండండి.'},
      "i want to go home": {Hindi:'मैं घर जाना चाहता/चाहती हूँ।', Telugu:'నేను ఇంటికి వెళ్లాలని కోరుకుంటున్నాను.'},
      "thank you": {Hindi:'धन्यवाद।', Telugu:'ధన్యవాదాలు.'},
      "i am feeling sick": {Hindi:'मैं अस्वस्थ महसूस कर रहा/रही हूँ।', Telugu:'నేను అనారోగ్యంగా భావిస్తున్నాను.'},
      "hello": {Hindi:'नमस्ते', Telugu:'నమస్కారం'},
      "yes": {Hindi:'हाँ', Telugu:'అవును'},
      "no": {Hindi:'नहीं', Telugu:'కాదు'},
      "call my family": {Hindi:'मेरे परिवार को बुलाओ।', Telugu:'నా కుటుంబాన్ని కాల్ చేయండి.'},
      "i need medical assistance": {Hindi:'मुझे चिकित्सा सहायता की आवश्यकता है।', Telugu:'నాకు వైద్య సహాయం అవసరం.'},
      "good morning": {Hindi:'सुप्रभात।', Telugu:'శుభోదయం.'},
      "i am hungry": {Hindi:'मैं भूखा हूँ।', Telugu:'నేను ఆకలిగా ఉన్నాను.'},
      "where are you going": {Hindi:'तुम कहाँ जा रहे हो?', Telugu:'నువ్వు ఎక్కడికి వెళ్ళిపోతున్నావు?'},
      "please help me": {Hindi:'कृपया मेरी मदद करें।', Telugu:'దయచేసి నాకు సహాయం చేయండి.'}
    };
    function normalize(s){
      return (s||'').toLowerCase().replace(/[\u2000-\u206F\u2E00-\u2E7F\p{P}\p{S}]/gu,'').replace(/\s+/g,' ').trim();
    }
    const n = normalize(original);
    const tnorm = (targetLabel||'Hindi').toLowerCase();
    try{
      const r = await fetch(API+"/api/translate",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:original,target_language:targetLabel})});
      if(r.ok){
        const d = await r.json();
        if(d && d.translated) return {translated:d.translated, source:'server'};
      }
      const txt = await r.text().catch(()=>"");
      if(r.status===401 || r.status===429 || r.status>=500 || /insufficient_quota|credit_balance_exhausted/i.test(txt)){
        // fall through to local
      }
    }catch(err){
      // network or other — fall back to local
    }
    if(n in localMap){
      const entry = localMap[n];
      if(tnorm.startsWith('h')) return {translated: entry.Hindi, source:'local'};
      if(tnorm.startsWith('t')) return {translated: entry.Telugu, source:'local'};
    }
    return {translated:null, source:'none'};
  }

  function handleKeyPress(key){
    // Special keys handling
    if(key==="[SPACE]") setComposed(s=>s+" ");
    else if(key==="[DELETE]") setComposed(s=>s.slice(0,-1));
    else if(key==="[CLEAR]") setComposed("");
    else if(key==="[SPEAK]"){
      // speak composed text through call pipeline
      if(composed.trim()) { setText(composed); setImproved(composed); speakIntoCall(composed, language); }
    }
    
    else if(key==="[AI IMPROVE]"){
      if(composed.trim()){
        setText(composed); setImproved(composed); aiAction("improve");
      }
    } else {
      // regular character
      setComposed(s=>s+key);
    }
    // visual feedback
    setSelectionState("SELECTED");
    setTimeout(()=>setSelectionState("READY"),400);
  }

  function handleKeyDown(e){
    // Allow physical keyboard input for testing
    if(e.key.length===1){ setComposed(s=>s+e.key.toUpperCase()); }
    else if(e.key==='Backspace'){ setComposed(s=>s.slice(0,-1)); }
    else if(e.key===' '){ setComposed(s=>s+" "); }
    else if(e.key==='Enter'){ speak(composed); }
  }

  useEffect(()=>{ window.addEventListener('keydown',handleKeyDown); return ()=>window.removeEventListener('keydown',handleKeyDown); },[composed]);
  function stopAllSpeech(){
    try{ // stop any WebAudio buffer sources
      sourcesRef.current.forEach(s=>{try{s.stop()}catch(_){}});
      sourcesRef.current.clear();
    }catch(_){ }
    try{ // stop speechSynthesis
      if('speechSynthesis' in window){ window.speechSynthesis.cancel(); utteranceRef.current=null; }
    }catch(_){ }
    setTtsState("Stopped");
    setStatus("TTS stopped.");
  }

  async function speak(textToSpeak, langLabel){
    const text = (typeof textToSpeak === 'string') ? textToSpeak : (improved||textToSpeak||text||"");
    const lang = langLabel || language || 'English';
    if(!text || !text.trim()){ setStatus("Nothing to speak."); return; }
    stopAllSpeech();
    const codeMap = {English:'en', Hindi:'hi', Telugu:'te'};
    const code = codeMap[lang] || (lang.toLowerCase().startsWith('h')?'hi':(lang.toLowerCase().startsWith('t')?'te':'en'));
    // For non-English targets (Hindi/Telugu), translate first unless the given text already appears to be in the target script (keeps Test Voice working)
    let textToDeliver = text;
    const isHindiScript = /\p{Script=Devanagari}/u.test(text);
    const isTeluguScript = /\p{Script=Telugu}/u.test(text);
    if(code==='hi' && !isHindiScript){
      setStatus('Translating...');
      console.log('Original:', text);
      console.log('Target language:', 'hi');
      const resp = await translateText(text,'Hindi');
      if(!resp || !resp.translated){ setStatus('Translation unavailable.'); return; }
      textToDeliver = resp.translated;
      setAiOriginal(text); setAiTranslated(resp.translated); setAiRespLanguage('hi');
      console.log('Translated:', resp.translated);
      if(resp.source === 'local') setStatus('Using local translation'); else setStatus('Translating...');
    } else if(code==='te' && !isTeluguScript){
      setStatus('Translating...');
      console.log('Original:', text);
      console.log('Target language:', 'te');
      const resp = await translateText(text,'Telugu');
      if(!resp || !resp.translated){ setStatus('Translation unavailable.'); return; }
      textToDeliver = resp.translated;
      setAiOriginal(text); setAiTranslated(resp.translated); setAiRespLanguage('te');
      console.log('Translated:', resp.translated);
      if(resp.source === 'local') setStatus('Using local translation'); else setStatus('Translating...');
    }
    // Try browser voice first (respect selectedVoiceURI and language)
    const {voice:browserVoice, reason:voiceReason} = selectBrowserVoice(lang);
    if(browserVoice){
      try{
        const u=new SpeechSynthesisUtterance(textToDeliver);
        u.voice = browserVoice;
        // set utterance.lang according to target
        u.lang = browserVoice.lang || (code==='hi'? 'hi-IN': code==='te'? 'te-IN':'en-US');
        u.rate = rate; u.pitch = pitch; u.volume = volume;
        u.onstart = ()=>{ setTtsState('Speaking'); setTtsSource('Browser'); setStatus(`Speaking ${lang} — Browser TTS`); };
        u.onend = ()=>{ setTtsState('Stopped'); setStatus('Speech finished.'); };
        utteranceRef.current = u;
        console.log('Selected voice:', browserVoice?.name);
        console.log('Voice language:', browserVoice?.lang);
        window.speechSynthesis.speak(u);
        return;
      }catch(e){ setStatus('Browser TTS failed: '+String(e)); }
    }
    // No browser voice available for requested language
    setStatus(`${lang} voice is not available on this device.`);
    // Try server/cloud TTS as optional fallback
    try{
      // send translated text when available so server TTS speaks the target language text
      const r = await fetch(API+"/api/tts",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:textToDeliver,language:code})});
      if(!r.ok){
        let msg='Server TTS failed';
        try{const j=await r.json(); if(j?.error) msg=j.error;}catch(_){ }
        setStatus(msg + ' — no suitable browser voice.');
        return;
      }
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = new Audio(url); a.onended=()=>{ URL.revokeObjectURL(url); setTtsState('Stopped'); setStatus('Speech finished.'); };
      setTtsState('Speaking'); setTtsSource('Server'); setStatus(`Playing ${lang} (server TTS)...`);
      // inject into active call mixer if a call is active
      if(callRef.current){ try{ await playAndInjectAITTS(blob); }catch(err){ console.error('inject play error', err); } }
      // still play locally
      await a.play();
      return;
    }catch(e){ setStatus('No TTS available for '+lang); }
  }

  async function prepareCallAudio(){
    // initialize mixer with mic and return mixed stream
    if(mixedStreamRef.current) return mixedStreamRef.current;
    const mic = await getMicrophoneStream();
    if(!mic || !mic.getTracks || mic.getTracks().length===0) throw new Error('No microphone tracks');
    micRef.current = mic; localStreamRef.current = mic; micStreamRef.current = mic;
    const mixed = await initializeCallAudio(mic);
    return mixed;
  }

  // Initialize mixer: mic -> micGain -> destination, aiGain -> destination
  async function initializeCallAudio(micStream){
    try{
      let audioContext = audioContextRef.current;
      if(!audioContext){ audioContext = new AudioContext(); audioContextRef.current = audioContext; }
      if(audioContext.state === 'suspended') await audioContext.resume();
      // disconnect previous mic source if present
      try{ if(micSourceRef.current){ try{ micSourceRef.current.disconnect(); }catch(_){} micSourceRef.current = null; } }catch(_){ }
      // create nodes
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain(); micGain.gain.value = 1;
      const aiGain = audioContext.createGain(); aiGain.gain.value = 1;
      const destination = audioContext.createMediaStreamDestination();
      // connect mic -> micGain -> destination
      micSource.connect(micGain);
      micGain.connect(destination);
      // connect aiGain -> destination (ai source will connect to aiGain when playing)
      aiGain.connect(destination);
      // store refs
      micSourceRef.current = micSource;
      micGainRef.current = micGain;
      aiGainRef.current = aiGain;
      mixerDestinationRef.current = destination;
      destRef.current = destination;
      mixedStreamRef.current = destination.stream;
      console.log('[CALL AUDIO] microphone connected');
      console.log('[CALL AUDIO] mixer initialized');
      console.log('[CALL AUDIO] mixed stream created');
      return mixedStreamRef.current;
    }catch(err){ console.error('initializeCallAudio error', err); throw err; }
  }

  // Central pipeline: translate (optional) -> request TTS -> inject into mixer -> optional local playback
  async function speakIntoCall(textArg, langLabel, options = {}){
    const phraseOriginal = (typeof textArg === 'string' && textArg.trim()) ? textArg.trim() : (improved || text || composed || "");
    if(!phraseOriginal || !phraseOriginal.trim()){ setStatus('Create/select a message first.'); return; }
    const targetLangLabel = langLabel || language || 'English';
    const opts = { translate: !!options.translate, local: !!options.local };
    setTtsState('Speaking');
    console.log('[CALL AUDIO] TTS requested', {phraseOriginal, targetLangLabel, opts});
    // Determine whether translation needed (for Hindi/Telugu)
    const codeMap = {English:'en', Hindi:'hi', Telugu:'te'};
    const targetCode = codeMap[targetLangLabel] || (targetLangLabel.toLowerCase().startsWith('h')?'hi':(targetLangLabel.toLowerCase().startsWith('t')?'te':'en'));
    let textToDeliver = phraseOriginal;
    try{
      // simple script detection to avoid translating text already in target script
      const isHindiScript = /\p{Script=Devanagari}/u.test(phraseOriginal);
      const isTeluguScript = /\p{Script=Telugu}/u.test(phraseOriginal);
      if((opts.translate || targetCode==='hi' || targetCode==='te') && !((targetCode==='hi' && isHindiScript) || (targetCode==='te' && isTeluguScript))){
        console.log('[CALL AUDIO] translation requested');
        const resp = await translateText(phraseOriginal, targetLangLabel);
        if(resp && resp.translated){ textToDeliver = resp.translated; setAiOriginal(phraseOriginal); setAiTranslated(resp.translated); setAiRespLanguage(targetCode); setStatus(resp.source === 'local' ? 'Using local translation' : 'Translation ready'); }
        else { console.log('[CALL AUDIO] translation failed or not available'); }
      }
      // Request TTS from server/provider
      console.log('[CALL AUDIO] requesting TTS from server');
      setStatus('Requesting TTS...');
      const r = await fetch(API + '/api/tts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: textToDeliver, language: targetCode }) });
      if(!r.ok){ const txt = await r.text().catch(()=> ''); console.error('[CALL AUDIO] TTS server error', r.status, txt); throw new Error('TTS provider failed'); }
      // Accept Blob or ArrayBuffer
      let payload;
      try{ payload = await r.blob(); }catch(_){ try{ payload = await r.arrayBuffer(); }catch(err){ throw err; } }
      console.log('[CALL AUDIO] TTS audio received');
      // Inject primary into mixer so remote hears it
      await injectAITTSIntoCall(payload instanceof Blob ? payload : payload);
      // Optionally play locally via Audio element if requested
      if(opts.local){ try{ if(payload instanceof Blob){ const url = URL.createObjectURL(payload); const a = new Audio(url); a.onended = ()=> URL.revokeObjectURL(url); await a.play().catch(()=>{}); } }catch(_){ } }
      setStatus('TTS injected into call.');
    }catch(err){
      console.error('[CALL AUDIO] speakIntoCall error', err);
      setStatus('TTS failed: ' + (err && err.message ? err.message : String(err)));
      // fallback: local-only speak (not injected)
      try{ speak(phraseOriginal, targetLangLabel); }catch(_){ setTtsState('Stopped'); }
    }finally{
      // keep TTS state until onended triggers set to stopped
    }
  }

  // Inject AI TTS (Blob or ArrayBuffer) into the mixer so remote hears it
  async function injectAITTSIntoCall(audioData){
    try{
      if(!audioContextRef.current){ console.log('[CALL AUDIO] No audio context available for injection'); throw new Error('No audio context'); }
      const audioContext = audioContextRef.current;
      if(audioContext.state === 'suspended') await audioContext.resume();
      console.log('[CALL AUDIO] AI TTS received');
      let arrayBuffer;
      if(audioData instanceof Blob){ arrayBuffer = await audioData.arrayBuffer(); }
      else if(audioData instanceof ArrayBuffer) arrayBuffer = audioData;
      else throw new Error('Unsupported audioData');
      console.log('[CALL AUDIO] AI TTS decoding');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      console.log('[CALL AUDIO] AI TTS decoded');
      const src = audioContext.createBufferSource(); src.buffer = audioBuffer;
      // ensure aiGain exists
      if(!aiGainRef.current){ aiGainRef.current = audioContext.createGain(); aiGainRef.current.gain.value = 1; aiGainRef.current.connect(mixerDestinationRef.current || audioContext.createMediaStreamDestination()); }
      src.connect(aiGainRef.current);
      // Also connect to destination for local monitoring if desired
      try{ src.connect(audioContext.destination); }catch(_){ }
      src.onended = ()=>{
        try{ src.disconnect(); }catch(_){}
        console.log('[CALL AUDIO] AI TTS playback finished');
        setTtsState('Stopped');
      };
      console.log('[CALL AUDIO] AI TTS injected into mixer');
      src.start();
      // track source for potential cleanup
      try{ sourcesRef.current.add(src); }catch(_){ }
    }catch(err){ console.error('injectAITTSIntoCall error', err); if(!callRef.current) console.log('[CALL AUDIO] No active PeerJS call; TTS not injected'); }
  }

  // Play locally and inject into call (inject primary)
  async function playAndInjectAITTS(audioBlob){
    try{
      // inject into call/mixer
      await injectAITTSIntoCall(audioBlob);
      // local playback (keep existing behavior)
      try{
        const url = URL.createObjectURL(audioBlob);
        const a = new Audio(url);
        a.onended = ()=>{ URL.revokeObjectURL(url); };
        await a.play().catch(_=>{});
      }catch(_){ }
    }catch(err){ console.error('playAndInjectAITTS error', err); }
  }

  async function startPeer(){
    if(peerRef.current) return;
    const peer=new Peer();
    peerRef.current=peer;
    peer.on("open",id=>{setCallPeerId(id);setCallStatus("Ready");});
    peer.on("error",e=>setCallStatus("Peer error: "+e.type));
    // Incoming call handler: do NOT auto-answer. Store the incoming call and wait for user action.
    peer.on("call", call => {
      // keep the incoming call object until user answers or rejects
      incomingCallRef.current = call;
      setIncoming(true);
      setIncomingCall(call);
      setCallStatus("Incoming call — waiting for answer");
      // NOTE: do not attach 'stream' handler here to avoid duplicate handlers; attach when answering
      call.on("close", ()=>{
        // incoming call closed by remote before answer or after
        setCallStatus("Disconnected");
        setIncoming(false);
        setIncomingCall(null);
      });
      call.on("error", err => {
        console.error('Incoming call error', err);
        setCallStatus('Call error');
        setIncoming(false);
        setIncomingCall(null);
      });
    });
  }
  function playRemote(stream){
    if(!remoteAudioRef.current) return;
    try{
      // attach remote stream and attempt to play; autoplay may be blocked until user interaction
      remoteAudioRef.current.srcObject = stream;
      const p = remoteAudioRef.current.play();
      if(p && typeof p.then === 'function') p.catch(err=>{ console.warn('remoteAudio play blocked',err); });
    }catch(err){ console.error('playRemote failed', err); }
  }

  async function answerIncomingCall(){
    const call = incomingCallRef.current;
    if(!call){ setCallStatus('No incoming call to answer'); setIncoming(false); setIncomingCall(null); return; }
    try{
      const localStream = await getMicrophoneStream();
      if(!localStream || !localStream.getTracks || localStream.getTracks().length===0) throw new Error('No microphone tracks');
      // initialize mixer and get mixed stream (mic + ai)
      const mixed = await initializeCallAudio(localStream);
      micRef.current = localStream; localStreamRef.current = localStream; micStreamRef.current = localStream;
      // answer the incoming call with the mixed stream so remote hears AI + mic
      call.answer(mixed);
      // store active call reference
      callRef.current = call;
      // remove any previous stream listeners if supported
      if(call.off && typeof call.off === 'function'){
        try{ call.off('stream'); }catch(_){ }
      }
      call.on('stream', async remoteStream => {
        try{
          remoteStreamRef.current = remoteStream;
          playRemote(remoteStream);
          if(remoteAudioRef.current){
            try{ await remoteAudioRef.current.play(); }catch(_){ }
          }
        }catch(err){ console.error('playRemote error',err); }
      });
      call.on('close', ()=>{
        setCallStatus('Disconnected');
        // cleanup local tracks
        try{ localStreamRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
        try{ micRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
        // clear refs and UI
        localStreamRef.current = null; micRef.current = null; callRef.current = null; incomingCallRef.current = null; remoteStreamRef.current = null;
        if(remoteAudioRef.current && remoteAudioRef.current.srcObject){ try{ const rs = remoteAudioRef.current.srcObject; rs.getTracks().forEach(t=>t.stop()); }catch(_){ } remoteAudioRef.current.srcObject = null; }
        setIncoming(false); setIncomingCall(null);
      });
      call.on('error', err => { console.error('Call error after answer', err); setCallStatus('Call error'); });
      setCallStatus('Connected');
      // hide incoming UI now that answer succeeded
      setIncoming(false);
      setIncomingCall(null);
      incomingCallRef.current = null;
      // inspect senders and force mixed track replacement after short delay
      setTimeout(async ()=>{
        try{ inspectWebRTCSenders(call); }catch(err){ console.warn('inspectSenders failed',err); }
        try{
          await forceMixedAudioTrackOnCall(call, mixed);
          console.log('[WEBRTC] forced mixed audio track on incoming answered call');
        }catch(err){ console.error('[WEBRTC] failed to force mixed track on incoming call', err); }
      },800);
    }catch(err){
      console.error('Error answering call', err, { name: err?.name, message: err?.message, isSecure: window.isSecureContext, protocol: location.protocol });
      if(err && err.name === 'NotAllowedError') setCallStatus('Microphone permission denied. Please allow microphone access.');
      else if(err && err.name === 'SecurityError') setCallStatus('Microphone blocked by browser security.');
      else if(err && err.name === 'NotFoundError') setCallStatus('No microphone was found on this device.');
      else if(err && err.name === 'AbortError') setCallStatus('Microphone request was interrupted.');
      else if(err && (err.name === 'MICROPHONE_API_UNAVAILABLE' || err.name === 'GET_USER_MEDIA_UNAVAILABLE')) setCallStatus('Microphone API unavailable. Open this app using HTTPS.');
      else setCallStatus('Answer failed: ' + (err && err.message ? err.message : String(err)));
      setIncoming(false);
      setIncomingCall(null);
      incomingCallRef.current = null;
    }
  }

  function rejectIncomingCall(){
    try{
      const call = incomingCallRef.current;
      if(call){ try{ call.close(); }catch(_){ } }
    }catch(_){ }
    // cleanup refs
    try{ localStreamRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
    try{ if(remoteAudioRef.current && remoteAudioRef.current.srcObject){ const rs = remoteAudioRef.current.srcObject; rs.getTracks().forEach(t=>t.stop()); remoteAudioRef.current.srcObject = null; } }catch(_){ }
    incomingCallRef.current = null;
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setIncoming(false);
    setIncomingCall(null);
    setCallStatus('Call rejected');
  }
  async function callPeer(){
    if(!remoteId.trim()){setCallStatus("Enter receiver Peer ID.");return;}
    await startPeer();
    let stream;
    try{
      stream = await prepareCallAudio();
    }catch(err){
      console.error('Microphone unavailable for outgoing call', err);
      setCallStatus('Microphone unavailable — allow microphone access and use HTTPS.');
      return;
    }
    if(!stream){ setCallStatus('Microphone unavailable — allow microphone access and use HTTPS.'); return; }
    // Verify mixed stream before creating outgoing call
    try{
      console.log('[WEBRTC] OUTGOING MIXED STREAM', stream);
      try{
        const tracks = stream.getAudioTracks ? stream.getAudioTracks().map(track=>({ id: track.id, enabled: track.enabled, muted: track.muted, readyState: track.readyState })) : [];
        console.log('[WEBRTC] MIXED AUDIO TRACKS', tracks);
      }catch(_){ }
    }catch(_){ }
    const call = peerRef.current.call(remoteId.trim(), stream);
    callRef.current = call; setCallStatus("Calling...");
    // attach stream handler exactly once
    call.on("stream", s => { remoteStreamRef.current = s; playRemote(s); setCallStatus("Connected"); });
    call.on("close", ()=>{
      setCallStatus("Disconnected");
      try{ localStreamRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
      try{ if(remoteAudioRef.current && remoteAudioRef.current.srcObject){ const rs = remoteAudioRef.current.srcObject; rs.getTracks().forEach(t=>t.stop()); remoteAudioRef.current.srcObject = null; } }catch(_){ }
      localStreamRef.current = null; micRef.current = null; callRef.current = null; remoteStreamRef.current = null;
    });
    call.on("error", e => { console.error('Outgoing call error', e); setCallStatus("Call error: "+(e?.type||e?.message||String(e))); });
    // Inspect senders and force mixed track replacement after call established
    setTimeout(async ()=>{
      try{ inspectWebRTCSenders(call); }catch(err){ console.warn('inspectSenders failed',err); }
      try{
        await forceMixedAudioTrackOnCall(call, stream);
        console.log('[WEBRTC] forced mixed audio track on outgoing call');
      }catch(err){ console.error('[WEBRTC] failed to force mixed track on outgoing call', err); }
    }, 800);
  }
  function endCall(){
    try{
      // close active call
      // close active call
      try{ callRef.current?.close(); }catch(_){ }
      // close any incoming call waiting
      try{ incomingCallRef.current?.close(); }catch(_){ }
      // destroy peer (existing behavior)
      try{ peerRef.current?.destroy(); }catch(_){ }
      // stop local mic tracks
      try{ localStreamRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
      try{ micRef.current?.getTracks().forEach(t=>t.stop()); }catch(_){ }
      // stop remote audio
      try{ if(remoteAudioRef.current && remoteAudioRef.current.srcObject){ const rs = remoteAudioRef.current.srcObject; rs.getTracks().forEach(t=>t.stop()); remoteAudioRef.current.srcObject = null; } }catch(_){ }
      // cleanup mixer nodes but keep AudioContext for reuse
      try{ if(micSourceRef.current){ try{ micSourceRef.current.disconnect(); }catch(_){ } micSourceRef.current = null; } }catch(_){ }
      try{ if(micGainRef.current){ try{ micGainRef.current.disconnect(); }catch(_){ } micGainRef.current = null; } }catch(_){ }
      try{ if(aiGainRef.current){ try{ aiGainRef.current.disconnect(); }catch(_){ } aiGainRef.current = null; } }catch(_){ }
      try{ if(mixerDestinationRef.current){ /* no disconnect method for destination */ mixerDestinationRef.current = null; destRef.current = null; mixedStreamRef.current = null; } }catch(_){ }
    }catch(_){ }
    callRef.current=null;peerRef.current=null;micRef.current=null;ctxRef.current=null;destRef.current=null;setIncomingCall(null);
    incomingCallRef.current = null; localStreamRef.current = null; remoteStreamRef.current = null;
    setCallStatus("Ended"); setIncoming(false);
  }

  // Inspect WebRTC senders and compare track ids to mixed stream
  function inspectWebRTCSenders(call){
    try{
      const pc = call && call.peerConnection;
      const mixedId = mixedStreamRef.current?.getAudioTracks?.()[0]?.id;
      console.log('[WEBRTC] mixed track:', mixedId);
      if(!pc){ console.log('[WEBRTC] No peerConnection found on call'); return; }
      const senders = pc.getSenders ? pc.getSenders() : [];
      for(const sender of senders){
        if(!sender) continue;
        try{
          console.log('[WEBRTC] sender audio track:', sender.track?.id, sender.track?.enabled, sender.track?.readyState);
        }catch(_){ console.log('[WEBRTC] sender', sender); }
      }
      // find audio sender
      const audioSender = senders.find(s=>s.track && s.track.kind==='audio');
      if(audioSender){
        console.log('[WEBRTC] audio sender track id matches mixed?', audioSender.track.id === mixedId);
      } else {
        console.log('[WEBRTC] no audio sender found');
      }
    }catch(err){ console.error('inspectWebRTCSenders error', err); }
  }

  // Force the mixed audio track onto the RTCRtpSender for a given PeerJS call
  async function forceMixedAudioTrackOnCall(call, mixedStream){
    function wait(ms){return new Promise(r=>setTimeout(r,ms));}
    try{
      if(!call) throw new Error('No call provided');
      // wait for peerConnection to exist
      let pc = call.peerConnection;
      let attempts=0;
      while(!pc && attempts < 30){ await wait(200); pc = call.peerConnection; attempts++; }
      if(!pc) throw new Error('No peerConnection on call');
      // get senders
      let senders = pc.getSenders ? pc.getSenders() : [];
      let audioSender = senders.find(s => s && s.track && s.track.kind === 'audio');
      // try again if not found
      if(!audioSender){ await wait(200); senders = pc.getSenders ? pc.getSenders() : []; audioSender = senders.find(s => s && s.track && s.track.kind === 'audio'); }
      if(!audioSender) throw new Error('No audio RTCRtpSender found');
      const mixedTrack = mixedStream?.getAudioTracks?.().find(t=>t && t.readyState === 'live') || mixedStream?.getAudioTracks?.()[0];
      if(!mixedTrack) throw new Error('No live audio track found in mixedStream');
      // replaceTrack to ensure sender uses mixed track
      if(typeof audioSender.replaceTrack === 'function'){
        await audioSender.replaceTrack(mixedTrack);
      } else {
        throw new Error('RTCRtpSender.replaceTrack is not supported in this environment');
      }
      // Log verification
      console.log('[WEBRTC] MIXED TRACK ID:', mixedTrack?.id);
      console.log('[WEBRTC] SENDER TRACK ID:', audioSender?.track?.id);
      console.log('[WEBRTC] SENDER READY STATE:', audioSender?.track?.readyState);
      console.log('[WEBRTC] TRACK MATCH:', audioSender?.track?.id === mixedTrack?.id);
      return { ok: true, mixedId: mixedTrack?.id, senderId: audioSender?.track?.id };
    }catch(err){ console.error('forceMixedAudioTrackOnCall error', err); throw err; }
  }

  // Navigate back to home safely
  function handleHome(){
    try{ stopGaze(); }catch(_){ }
    setPage("home");
  }

  async function startGaze(){
    if(gazeOn)return;
    setStatus("Loading camera + gaze model...");
    try{
      const stream = await getCameraStream();
      videoRef.current.srcObject = stream; await videoRef.current.play();
    }catch(err){
      console.error('startGaze getCameraStream error', err, { name: err?.name, message: err?.message, isSecure: window.isSecureContext, protocol: location.protocol });
      if(err && (err.name === 'CAMERA_API_UNAVAILABLE' || err.name === 'GET_USER_MEDIA_UNAVAILABLE')) setStatus('Camera API unavailable. Open this app using HTTPS.');
      else setStatus('Camera unavailable: ' + (err && err.message ? err.message : String(err)));
      return;
    }
    const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    const lm=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"},runningMode:"VIDEO",numFaces:1});
    landmarkerRef.current=lm; setGazeOn(true); setStatus("Gaze mode active: look left/right, long blink to select.");
    loopGaze();
  }
  function stopGaze(){
    setGazeOn(false); if(rafRef.current) cancelAnimationFrame(rafRef.current);
    videoRef.current?.srcObject?.getTracks().forEach(t=>t.stop()); videoRef.current.srcObject=null;
  }
  function loopGaze(){
    if(!videoRef.current||!landmarkerRef.current) return;
    const now = performance.now();
    const res = landmarkerRef.current.detectForVideo(videoRef.current, now);
    const face = res.faceLandmarks?.[0];
    if(!face){
      setFaceDetected(false);
      setEyesDetected({left:false,right:false});
      setGazeCursor(prev=>({...prev,visible:false}));
      rafRef.current = requestAnimationFrame(loopGaze);
      return;
    }
    setFaceDetected(true);
    // check iris / eye landmarks
    const iris = face[473];
    const eyeTop = face[159];
    const eyeBottom = face[145];
    const leftEyePresent = !!eyeTop; const rightEyePresent = !!eyeBottom && !!iris;
    setEyesDetected({left:leftEyePresent,right:rightEyePresent});
    if(!iris || !eyeTop || !eyeBottom){
      setStatus('Eyes not detected clearly');
      setGazeCursor(prev=>({...prev,visible:false}));
      rafRef.current = requestAnimationFrame(loopGaze);
      return;
    }

    // pupil / iris normalized coords
    const rawX = iris.x; const rawY = iris.y;
    gazeRawRef.current = {x:rawX,y:rawY};

    // blink detection using vertical eye openness
    const openness = Math.abs(eyeBottom.y - eyeTop.y);
    if(openness < 0.018){
      if(!blinkStartRef.current) blinkStartRef.current = now;
      setBlinkState('CLOSED');
      const dur = now - (blinkStartRef.current||now);
      setBlinkDuration(Math.round(dur));
      setLongBlinkFlag(dur >= BLINK_SELECT_MS);
    } else {
      // blink ended: if duration was long and stable, selection may already have been handled
      if(blinkStartRef.current){
        const dur = now - blinkStartRef.current;
        // reset blink
        blinkStartRef.current = null;
        setBlinkDuration(0);
        setLongBlinkFlag(false);
      }
      setBlinkState('OPEN');
    }

    // Normalize using calibration or defaults
    const calib = calibrationRef.current || {};
    const vLeft = calib.left?.x ?? 0.18; const vRight = calib.right?.x ?? 0.82;
    const vUp = calib.up?.y ?? 0.2; const vDown = calib.down?.y ?? 0.8;
    let nx = (rawX - vLeft) / (vRight - vLeft); let ny = (rawY - vUp) / (vDown - vUp);
    nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
    gazeNormRef.current = {x:nx,y:ny};

    // smoothing
    const prev = smoothGazeRef.current || {x:0.5,y:0.5}; const alpha = 0.22;
    const smoothX = prev.x*(1-alpha) + nx*alpha; const smoothY = prev.y*(1-alpha) + ny*alpha;
    smoothGazeRef.current = {x:smoothX,y:smoothY};

    // Map gaze to keyboard or fallback row/col
    updateKeyPositions();
    const keys = keysPosRef.current || [];
    const kb = keyboardRef.current;
    let gx = 0, gy = 0;
    if(kb){ const rect = kb.getBoundingClientRect(); gx = rect.left + smoothX*rect.width; gy = rect.top + smoothY*rect.height; setGazeCursor({x:gx,y:gy,visible:true}); }
    else { setGazeCursor(prev=>({...prev,visible:false})); }

    let candidateKey = null;
    if(keys.length){
      // find nearest key center
      let best=null, bestDist=1e9;
      for(const k of keys){ const dx=k.cx-gx, dy=k.cy-gy, d=dx*dx+dy*dy; if(d<bestDist){bestDist=d;best=k;} }
      if(best) candidateKey = best.key;
    } else {
      // fallback: compute by normalized coords into rows/cols
      const rows = [['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['Z','X','C','V','B','N','M']];
      const rowIndex = Math.min(rows.length-1, Math.floor(smoothY * rows.length));
      const row = rows[rowIndex];
      let col = Math.floor(smoothX * row.length); if(col<0) col=0; if(col>=row.length) col=row.length-1;
      candidateKey = row[col];
    }

    // Hover stability and dwell
    const prevStable = hoverStableRef.current || {key:null,since:0};
    if(!candidateKey){ hoverStableRef.current={key:null,since:now}; setGazeStable(false); }
    else {
      if(!prevStable.key || prevStable.key !== candidateKey){ hoverStableRef.current={key:candidateKey,since:now}; setGazeStable(false); }
      else {
        if(now - prevStable.since > 350){ // dwell threshold
          if(!hoveredKeyRef.current || hoveredKeyRef.current.key !== candidateKey){ hoveredKeyRef.current = {key:candidateKey}; setHoveredKey({key:candidateKey}); }
          setGazeStable(true);
        }
      }
    }

    // long blink selection with debounce
    if(longBlinkFlag && hoveredKeyRef.current && hoveredKeyRef.current.key){
      const last = lastSelectionRef.current || 0;
      if(now - last > SELECTION_DEBOUNCE_MS){
        handleKeyPress(hoveredKeyRef.current.key);
        setStatus('Selected: '+hoveredKeyRef.current.key);
        lastSelectionRef.current = now;
      }
      // reset blink start so we don't re-trigger
      blinkStartRef.current = null; setLongBlinkFlag(false);
    }

    drawFace(face);
    rafRef.current = requestAnimationFrame(loopGaze);
  }

  function mapGazeToKey(x,y,w,h){
    // Keyboard layout rows
    const rows=[
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['Z','X','C','V','B','N','M'],
    ];
    // define keyboard area below video: use bottom 40% of video for keyboard mapping
    const kbTop = h*0.55; const kbHeight = h*0.35;
    if(y<kbTop || y>kbTop+kbHeight) return null;
    const rowHeight = kbHeight/rows.length;
    const rowIndex = Math.min(rows.length-1, Math.floor((y-kbTop)/rowHeight));
    const row = rows[rowIndex];
    // compute key width based on max keys (10)
    const keyW = w/10;
    // center row by offset
    const totalRowWidth = row.length*keyW; const offset = (w - totalRowWidth)/2;
    // find nearest col
    let col = Math.floor((x - offset)/keyW);
    if(col<0) col=0; if(col>=row.length) col=row.length-1;
    const key = row[col];
    return {row:rowIndex,col:key?col:0,key:key};
  }
  function changeGaze(delta){
    setSelected(v=>{const n=(v+delta+PHRASES.length)%PHRASES.length; gazeIndexRef.current=n; return n;});
  }
  function drawFace(face){
    const c=canvasRef.current,v=videoRef.current;if(!c||!v)return;
    c.width=v.videoWidth;c.height=v.videoHeight;const x=face[473].x*c.width,y=face[473].y*c.height;
    const g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);g.beginPath();g.arc(x,y,8,0,Math.PI*2);g.stroke();
    // draw gaze cursor on video overlay for debugging
    const sg = smoothGazeRef.current; if(sg){
      const gx = sg.x * c.width, gy = sg.y * c.height;
      g.fillStyle='rgba(0,150,255,0.7)'; g.beginPath(); g.arc(gx,gy,6,0,Math.PI*2); g.fill();
    }
  }

  useEffect(()=>()=>{stopGaze();endCall()},[]);

  if(page==="home") return <div className="app"><header><h1>AI Accessible Communication Assistant</h1><p>Eye gaze + AI + natural voice communication</p></header>
    <div className="cards">
      <button onClick={()=>setPage("normal")}><b>Normal TTS</b><span>Type → AI → Voice</span></button>
      <button onClick={()=>setPage("gaze")}><b>Gaze Communication</b><span>Gaze → Blink → AI → Voice</span></button>
      <button onClick={()=>setPage("call")}><b>AI Voice Call</b><span>WebRTC + AI TTS</span></button>
    </div></div>;

  return <div className="app">
    <header><button type="button" className="back" onClick={handleHome} aria-label="Home">← Home</button><h1>{page==="normal"?"Normal AI TTS":page==="gaze"?"Gaze Communication":"AI Voice Call"}</h1></header>

    {page!=="call" && <section className="panel">
      <label>Message</label><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Type a message or select one using gaze..."/>
      <div className="row">{PHRASES.slice(0,6).map(p=><button className="chip" onClick={()=>{ if(callRef.current){ speakIntoCall(p, language, {translate:true}); } else { setText(p); setImproved(p); setComposed(p); } }} key={p}>{p}</button>)}</div>
      <div className="controls">
        <select value={tone} onChange={e=>setTone(e.target.value)}>{MODES.map(x=><option key={x}>{x}</option>)}</select>
        <div style={{display:'flex',gap:10,alignItems:'center',marginTop:8}}>
          <label style={{fontWeight:700}}>Language:</label>
          <select value={language} onChange={e=>setLanguage(e.target.value)}>
            <option>English</option>
            <option>Hindi</option>
            <option>Telugu</option>
          </select>
          <label style={{fontWeight:700,marginLeft:12}}>Voice:</label>
          <select value={selectedVoiceURI} onChange={e=>setSelectedVoiceURI(e.target.value)}>
            <option value="">(browser default)</option>
            {voices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.lang}</option>)}
          </select>
          <div style={{marginLeft:12}}>
            {voiceAvailable?null:<span style={{color:'crimson',fontWeight:700}}>No browser voice for {language}, will fallback to available voice or server TTS.</span>}
          </div>
        </div>
        <button onClick={()=>aiAction("improve")} disabled={busy}>✨ Improve</button>
        <button onClick={()=>aiAction("complete")} disabled={busy}>🧠 Complete</button>
        <button onClick={()=>aiAction("translate")} disabled={busy}>🌐 Translate</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:8}}>
        <div>
          <label style={{display:'block'}}>Speed</label>
          <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e=>setRate(Number(e.target.value))} />
        </div>
        <div>
          <label style={{display:'block'}}>Pitch</label>
          <input type="range" min="0.5" max="2" step="0.1" value={pitch} onChange={e=>setPitch(Number(e.target.value))} />
        </div>
        <div>
          <label style={{display:'block'}}>Volume</label>
          <input type="range" min="0" max="1" step="0.1" value={volume} onChange={e=>setVolume(Number(e.target.value))} />
        </div>
      </div>
      <div className="result"><b>AI Response</b><p>{improved||"AI output will appear here."}</p></div>
      {aiOriginal && <div className="result"><b>Original</b><p>{aiOriginal}</p></div>}
      {aiTranslated && <div className="result"><b>Translated ({aiRespLanguage})</b><p>{aiTranslated}</p></div>}
      <div style={{marginTop:8,padding:10,background:'#fbfcff',borderRadius:10}}>
        <div style={{fontWeight:700}}>TTS Diagnostics</div>
        <div>Available English voices: {voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith('en')).length}</div>
        <div>Available Hindi voices: {voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith('hi')).length}</div>
        <div>Available Telugu voices: {voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith('te')).length}</div>
        <div style={{marginTop:6}}>Selected voice: <b>{(voices.find(v=>v.voiceURI===selectedVoiceURI)?.name) || '(browser default)'}</b></div>
        <div>Voice language: <b>{(voices.find(v=>v.voiceURI===selectedVoiceURI)?.lang) || (selectBrowserVoice(language).voice?.lang) || '(n/a)'}</b></div>
        <div>Original: <b>{aiOriginal || text || '(none)'}</b></div>
        <div>Translated: <b>{aiTranslated || '(none)'}</b></div>
        <div>Target language: <b>{language}</b></div>
        <div>TTS source: <b>{ttsSource}</b></div>
        <div style={{marginTop:8}}>Test Voices: <button className="chip" onClick={()=>speakIntoCall('Hello, this is a voice test.','English')}>Test English</button> <button className="chip" onClick={()=>speakIntoCall('नमस्ते, यह हिंदी आवाज़ परीक्षण है।','Hindi')}>Test Hindi</button> <button className="chip" onClick={()=>speakIntoCall('నమస్కారం, ఇది తెలుగు వాయిస్ పరీక్ష.','Telugu')}>Test Telugu</button></div>
      </div>
      <div className="suggestions"><b>Smart Suggestions</b>{suggestions.map((s,i)=><button key={i} onClick={()=>{setText(s);setImproved(s); setComposed(s);}}>{s}</button>)}</div>
      <div style={{display:'flex',gap:8}}>
        <button className="speak" onClick={()=>speakIntoCall(text || composed || improved, language, {translate:true, local:true})}>🔊 Speak with AI Voice</button>
        <button className="chip" onClick={()=>stopAllSpeech()}>⏹ Stop</button>
        <div style={{alignSelf:'center',marginLeft:8}}>State: <b>{ttsState}</b></div>
      </div>
      {status&&<p className="status">{status}</p>}
    </section>}

    {page==="gaze" && <section className="panel"><h3>Gaze + Blink</h3><div className="camera"><video ref={videoRef} muted/><canvas ref={canvasRef}/></div>
      <div className="selected">Current phrase: <b>{PHRASES[selected]}</b></div>
      {!gazeOn?<button onClick={startGaze}>Start Camera</button>:<button onClick={stopGaze}>Stop Camera</button>}
      <p>Look toward keys; hold your eyes closed for about 0.65 sec to select a highlighted key.</p>
      <div style={{marginTop:12,marginBottom:12}}>
              <div style={{marginTop:8,marginBottom:8,border:'1px dashed #dbe6f1',padding:8,borderRadius:8}}>
                <div style={{fontWeight:700}}>Calibration: {calibrationState}</div>
                {!calibrating?
                  <div style={{marginTop:6}}><button className="chip" onClick={()=>{setCalibrating(true); setCalibStep(0); setCalibrationState('CALIBRATING')}}>Start Calibration</button> <button className="chip" onClick={()=>{calibrationRef.current={center:null,left:null,right:null,up:null,down:null}; setCalibrationState('NOT CALIBRATED');}}>Reset</button></div>
                  :
                  <div style={{marginTop:6}}>
                    <div>Step: <b>{CALIB_STEPS[calibStep].toUpperCase()}</b></div>
                    <div style={{marginTop:6}}>Look at the indicated position on the screen, then press Capture.</div>
                    <div style={{marginTop:6}}>
                      <button className="chip" onClick={()=>{
                        const raw = gazeRawRef.current; calibrationRef.current[CALIB_STEPS[calibStep]] = raw; setStatus(`Captured ${CALIB_STEPS[calibStep]} at ${raw.x.toFixed(2)},${raw.y.toFixed(2)}`);
                        const next = calibStep+1; if(next>=CALIB_STEPS.length){ setCalibrating(false); setCalibrationState('CALIBRATED'); setCalibStep(0); } else setCalibStep(next);
                        }}>Capture</button>
                      <button className="chip" onClick={()=>{ setCalibrating(false); setCalibrationState('NOT CALIBRATED'); }}>Cancel</button>
                    </div>
                  </div>
                }
              </div>
        <div style={{fontWeight:700}}>Composed Text</div>
        <div style={{minHeight:60,border:'2px solid #ccd4df',borderRadius:12,padding:12,fontSize:20,background:'#fff'}}>{composed||"(empty)"}</div>
      </div>
      <div ref={keyboardRef} style={{display:'grid',gap:8}}>
        {[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['Z','X','C','V','B','N','M']].map((row,ridx)=>
          <div key={ridx} style={{display:'flex',justifyContent:'center',gap:8}}>
            {row.map((k,cidx)=>{
              const active=hoveredKey && hoveredKey.key===k;
              return <button data-key={k} key={k} className={"chip"} onClick={()=>handleKeyPress(k)} style={{minWidth:48,minHeight:56,fontSize:20,background:active?'#ffd54f':'#e9eef7',border: active?'2px solid #ff9800':'0'}}>{k}</button>
            })}
          </div>
        )}
        <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'center'}}>
          <button data-key="[SPACE]" className="speak" onClick={()=>handleKeyPress('[SPACE]')}>[SPACE]</button>
          <button data-key="[DELETE]" className="chip" onClick={()=>handleKeyPress('[DELETE]')}>[DELETE]</button>
          <button data-key="[CLEAR]" className="chip" onClick={()=>handleKeyPress('[CLEAR]')}>[CLEAR]</button>
          <button data-key="[SPEAK]" className="speak" onClick={()=>handleKeyPress('[SPEAK]')}>[SPEAK]</button>
          <button data-key="[AI IMPROVE]" className="chip" onClick={()=>handleKeyPress('[AI IMPROVE]')}>[AI IMPROVE]</button>
        </div>
      </div>
      <div style={{display:'grid',gap:8}}>
        {/* keyboard rows */}
        {[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['Z','X','C','V','B','N','M']].map((row,ridx)=>
          <div key={ridx} style={{display:'flex',justifyContent:'center',gap:8}}>
            {row.map((k,cidx)=>{
              const active=hoveredKey && hoveredKey.row===ridx && hoveredKey.col===cidx;
              return <button key={k} className={"chip"} onClick={()=>handleKeyPress(k)} style={{minWidth:48,minHeight:56,fontSize:20,background:active?'#ffd54f':'#e9eef7',border: active?'2px solid #ff9800':'0'}}>{k}</button>
            })}
          </div>
        )}
      </div>
      <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'center'}}>
        <button className="speak" onClick={()=>handleKeyPress('[SPACE]')}>[SPACE]</button>
        <button className="chip" onClick={()=>handleKeyPress('[DELETE]')}>[DELETE]</button>
        <button className="chip" onClick={()=>handleKeyPress('[CLEAR]')}>[CLEAR]</button>
        <button className="speak" onClick={()=>handleKeyPress('[SPEAK]')}>[SPEAK]</button>
        <button className="chip" onClick={()=>handleKeyPress('[AI IMPROVE]')}>[AI IMPROVE]</button>
      </div>
      <div style={{marginTop:10,fontSize:14}}>
        <strong>Gaze:</strong> {gazeOn? 'ON':'OFF'} • <strong>Camera:</strong> {videoRef.current?.srcObject? 'CONNECTED':'DISCONNECTED'} • <strong>Face:</strong> {faceDetected? 'DETECTED':'NOT DETECTED'}
        <br/>
        <strong>Gaze X:</strong> {gazeNormRef.current.x.toFixed(2)} • <strong>Gaze Y:</strong> {gazeNormRef.current.y.toFixed(2)} • <strong>Current key:</strong> {hoveredKey?.key||'-'}
        <br/>
        <strong>Gaze stable:</strong> {gazeStable? 'YES':'NO'} • <strong>Blink:</strong> {blinkState} • <strong>Blink duration:</strong> {blinkDuration} ms • <strong>Long blink:</strong> {longBlinkFlag? 'YES':'NO'}
      </div>
      <div style={{marginTop:8}}>
        <button className="chip" onClick={()=>setGazeDebugVisible(v=>!v)}>{gazeDebugVisible? 'Hide':'Show'} Gaze Debug</button>
        {(!eyesDetected.left || !eyesDetected.right) && <div style={{color:'crimson',marginTop:6}}>Eyes not detected clearly — calibration required</div>}
        {gazeDebugVisible && <div style={{marginTop:8,background:'#f8fbff',padding:8,borderRadius:8}}>
          <div><strong>Gaze Debug</strong></div>
          <div>Face detected: {faceDetected? 'YES':'NO'}</div>
          <div>Left eye: {eyesDetected.left? 'detected':'not detected'}</div>
          <div>Right eye: {eyesDetected.right? 'detected':'not detected'}</div>
          <div>Gaze X: {gazeNormRef.current.x.toFixed(3)}</div>
          <div>Gaze Y: {gazeNormRef.current.y.toFixed(3)}</div>
          <div>Current key: {hoveredKey?.key||'-'}</div>
          <div>Blink duration: {blinkDuration} ms</div>
          <div>Long blink: {longBlinkFlag? 'YES':'NO'}</div>
        </div>}
      </div>
      {/* gaze cursor */}
      {gazeCursor.visible && <div style={{position:'fixed',left:gazeCursor.x-6,top:gazeCursor.y-6,width:12,height:12,borderRadius:6,background:'#0077ff',pointerEvents:'none',zIndex:9999}}></div>}
    </section>}

    {page==="call" && <section className="panel">
      <h2>AI Voice Call</h2><p className="small">Open this page on two devices/tabs. Both need internet for PeerJS signaling.</p>
      <button onClick={startPeer}>Generate My Peer ID</button>
      <div className="idbox">My Peer ID: <b>{callPeerId||"—"}</b></div>
      <input value={remoteId} onChange={e=>setRemoteId(e.target.value)} placeholder="Enter receiver Peer ID"/>
      <div className="controls"><button onClick={callPeer}>📞 Start Call</button><button onClick={endCall}>⛔ End Call</button></div>
      <div style={{marginTop:8}}><button className="chip" onClick={()=>{ if(!callRef.current){ setStatus('No active call'); return; } testRemoteAudio(); }}>🧪 Test Remote Audio</button></div>
      <div className="callstate">Status: <b>{callStatus}</b>{incoming&&" • Incoming call"}</div>
      {incomingCall && <div style={{marginTop:12,padding:12,background:'#fff7e6',border:'1px solid #ffd699',borderRadius:8,display:'flex',flexDirection:'column',gap:8,alignItems:'center'}}>
        <div style={{fontSize:20}}>📞 Incoming Call</div>
        <div>Someone is calling you</div>
        <div style={{display:'flex',gap:12,marginTop:8}}>
          <button onClick={answerIncomingCall} style={{background:'#28a745',color:'#fff',padding:'12px 20px',fontSize:18,borderRadius:8,border:'none',minWidth:120}}>Answer</button>
          <button onClick={rejectIncomingCall} style={{background:'#dc3545',color:'#fff',padding:'12px 20px',fontSize:18,borderRadius:8,border:'none',minWidth:120}}>Reject</button>
        </div>
      </div>}
      <hr/>
      <label>AI message to send through call</label><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Type/select what the user wants to say"/>
      <div className="row">{PHRASES.map(p=><button className="chip" onClick={()=>{ if(callRef.current){ speakIntoCall(p, language, {translate:true}); } else { setText(p); setImproved(p); setComposed(p); } }} key={p}>{p}</button>)}</div>
      <div className="controls"><button onClick={()=>aiAction("improve")} disabled={busy}>✨ AI Improve</button><button onClick={()=>aiAction("complete")} disabled={busy}>🧠 Suggest</button></div>
      <div className="result"><b>Final message</b><p>{improved||text||"—"}</p></div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <button className="speak" onClick={speakIntoCall}>📢 Send AI Voice Through Call</button>
        <button className="chip" onClick={()=>stopAllSpeech()}>⏹ Stop</button>
        <div style={{marginLeft:8}}>State: <b>{ttsState}</b></div>
      </div>
      <audio ref={remoteAudioRef} autoPlay controls/>
      {status&&<p className="status">{status}</p>}
    </section>}
  </div>
}