import React, { useState, useEffect, useRef, useCallback } from 'react';
import RiftMap from './RiftMap';
import { parseIncidentPayload, generateAgentResolution, handleGeneralChat } from './lib/gemini';
import { MarkerType, addEdge, applyNodeChanges, applyEdgeChanges } from 'reactflow';
import { playAlertBeep, playSuccessChirp } from './lib/audio';
import jsPDF from 'jspdf';

const initialNodes = [
  { id: 'lb-1', type: 'rift', position: { x: 250, y: 50 }, data: { label: 'US-EAST-LB', ip: '10.0.0.12', type: 'Load Balancer', status: 'healthy' } },
  { id: 'api-1', type: 'rift', position: { x: 100, y: 200 }, data: { label: 'AUTH-GATEWAY', ip: '10.0.1.45', type: 'API Gateway', status: 'healthy' } },
  { id: 'api-2', type: 'rift', position: { x: 400, y: 200 }, data: { label: 'PAYMENT-API', ip: '10.0.1.46', type: 'Application Node', status: 'healthy' } },
  { id: 'db-1', type: 'rift', position: { x: 100, y: 350 }, data: { label: 'CORE-POSTGRES', ip: '10.0.2.10', type: 'Database Master', status: 'healthy' } },
  { id: 'cache-1', type: 'rift', position: { x: 400, y: 350 }, data: { label: 'REDIS-CLUSTER', ip: '10.0.2.22', type: 'In-Memory Cache', status: 'healthy' } },
];

const initialEdges = [
  { id: 'e1-2', source: 'lb-1', target: 'api-1', animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } },
  { id: 'e1-3', source: 'lb-1', target: 'api-2', animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } },
  { id: 'e2-4', source: 'api-1', target: 'db-1', animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } },
  { id: 'e3-5', source: 'api-2', target: 'cache-1', animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } },
  { id: 'e2-5', source: 'api-1', target: 'cache-1', animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } },
];

const chaosPayloads = [
  "DETECTED DDOS ON MAIN INGRESS",
  "SQL INJECTION ATTEMPT '; DROP TABLE USERS;",
  "OOM ERROR MEMORY LEAK REPORTED",
  "UNAUTHORIZED JWT TOKEN USAGE",
  "FAILED CONNECTION TIMEOUT 504"
];

export default function App() {
  const [activeTab, setActiveTab] = useState('topology'); 
  const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), msg: '[SYS] RIFT Unified Dashboard Active.', type: '' }]);
  const [patches, setPatches] = useState([]);
  
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [workflowState, setWorkflowState] = useState(0); 

  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [modalInputKey, setModalInputKey] = useState("");

  const [ingestText, setIngestText] = useState("");
  const [uploadedFileIndicator, setUploadedFileIndicator] = useState(null);
  const [imagePayload, setImagePayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [theme, setTheme] = useState('light');

  // === AEGIS Voice System State ===
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | listening | processing | speaking
  const [conversationActive, setConversationActive] = useState(false);

  // === Text Chat Widget State ===
  const [aiChatLogs, setAiChatLogs] = useState([{ speaker: 'RIFT', text: "RIFT AI Assist ready. Ask anything about the platform, architecture, or threat analysis." }]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState("");
  const chatEndRef = useRef(null);
  
  // New features state
  const [isChaosMode, setIsChaosMode] = useState(false);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState(null);
  const [temporalHistory, setTemporalHistory] = useState([{ time: Date.now(), snapshot: { nodes: initialNodes, edges: initialEdges } }]);
  const [vcrIndex, setVcrIndex] = useState(-1); // -1 means live current state

  const logsEndRef = useRef(null);
  const reactFlowWrapper = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isSpeakingRef = useRef(false); // tracks if user voice detected

  const addLog = useCallback((msg, type = '') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
  }, []);

  useEffect(() => {
    if (activeTab === 'logs' || activeTab === 'topology') {
       logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handleTrigger = () => setShowApiKeyModal(true);
    window.addEventListener('trigger-api-key-modal', handleTrigger);
    return () => window.removeEventListener('trigger-api-key-modal', handleTrigger);
  }, []);

  useEffect(() => {
    const handleDaemonLog = (e) => {
        const transcript = `[PYTHON DAEMON INTERCEPT] ${e.detail}`;
        setIngestText(transcript);
        // Force asynchronous fire so React state can catch up nicely
        setTimeout(() => handleIngest(transcript), 100);
    };
    window.addEventListener('daemon-log', handleDaemonLog);
    return () => window.removeEventListener('daemon-log', handleDaemonLog);
  }, []); // eslint-disable-line

  const saveLocalApiKey = () => {
    if (modalInputKey.trim()) {
      localStorage.setItem('rift_api_key', modalInputKey.trim());
      setShowApiKeyModal(false);
      addLog('[SYS] Personal API Key injected into local browser storage.', 'sys');
    }
  };

  // Snapshot History Hook
  const saveSnapshot = useCallback(() => {
     setTemporalHistory(prev => {
         const newHistory = [...prev, { time: Date.now(), snapshot: { nodes, edges } }];
         // Keep last 20 snapshots
         if (newHistory.length > 20) newHistory.shift();
         return newHistory;
     });
  }, [nodes, edges]);

  // Chaos Mode Auto-Pilot hook
  useEffect(() => {
      let interval;
      if (isChaosMode && !isProcessing && vcrIndex === -1) {
          interval = setInterval(() => {
              if (nodes.length === 0) return;
              const randomPayload = chaosPayloads[Math.floor(Math.random() * chaosPayloads.length)];
              setIngestText(randomPayload);
              handleIngest(randomPayload);
          }, 12000);
      }
      return () => clearInterval(interval);
  }, [isChaosMode, isProcessing, nodes, vcrIndex]);

  // Graph Mechanics
  const onNodesChange = useCallback((changes) => {
    if (vcrIndex !== -1) return; // Prevent edits in history mode
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, [vcrIndex]);

  const onEdgesChange = useCallback((changes) => {
    if (vcrIndex !== -1) return;
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, [vcrIndex]);

  const onConnect = useCallback((connection) => {
    if (vcrIndex !== -1) return;
    setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: '#94a3b8' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } }, eds));
    saveSnapshot();
  }, [vcrIndex, saveSnapshot]);

  // Drag and Drop support
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
      event.preventDefault();
      if (vcrIndex !== -1) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');
      
      if (!type) return;

      const position = {
        x: event.clientX - reactFlowBounds.left - 100, // offset
        y: event.clientY - reactFlowBounds.top - 25,
      };

      const newNode = {
        id: `${type}-${Date.now()}`,
        type: 'rift',
        position,
        data: { label: `NEW-${type.toUpperCase()}`, ip: '10.x.x.x', type: type.toUpperCase(), status: 'healthy' }
      };

      setNodes((nds) => nds.concat(newNode));
      addLog(`[UI] Deployed new architectural node: ${newNode.data.label}`, 'ai');
      saveSnapshot();
  }, [vcrIndex, saveSnapshot, addLog]);

  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.type.startsWith('image/')) {
          setUploadedFileIndicator(`Image: ${file.name}`);
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64Data = reader.result.split(',')[1];
              setImagePayload({ type: 'image', mimeType: file.type, content: base64Data });
              setIngestText(""); 
          };
          reader.readAsDataURL(file);
      } else {
          setUploadedFileIndicator(`Text: ${file.name}`);
          setImagePayload(null);
          const reader = new FileReader();
          reader.readAsText(file);
      }
  };

  const exportPDF = (patch) => {
      const doc = new jsPDF();
      doc.setFont("courier", "bold");
      doc.setFontSize(22);
      doc.text("RIFT POST-MORTEM REPORT", 20, 20);
      doc.setFontSize(12);
      doc.setFont("courier", "normal");
      doc.text(`TIMESTAMP:    ${patch.time}`, 20, 40);
      doc.text(`TARGET NODE:  ${patch.node}`, 20, 50);
      doc.text(`THREAT VECTOR:${patch.attack}`, 20, 60);
      doc.text("---------------------------------------------------------", 20, 70);
      doc.setFont("courier", "bold");
      doc.text("DEVSECOPS REMEDIATION PATCH:", 20, 80);
      doc.setFont("courier", "normal");
      
      const splitTitle = doc.splitTextToSize(patch.patch, 170);
      doc.text(splitTitle, 20, 90);
      doc.save(`RIFT-Incident-${patch.node}-${Date.now()}.pdf`);
  };

  // ══════════════════════════════════════════════════
  // AEGIS — Continuous Conversation Voice System
  // Uses Voice Activity Detection (VAD) for hands-free
  // ══════════════════════════════════════════════════

  const aegisCleanup = () => {
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try { mediaRecorderRef.current.stop(); } catch(e) {}
      }
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
      }
      if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch(e) {}
          audioContextRef.current = null;
      }
      window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
  };

  const startListeningCycle = async () => {
      try {
          // Reuse existing stream or get new one
          if (!streamRef.current || !streamRef.current.active) {
              streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
          const stream = streamRef.current;

          // Set up AudioContext + Analyser for VAD
          if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
              audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const audioCtx = audioContextRef.current;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.3;
          source.connect(analyser);
          analyserRef.current = analyser;

          // Start MediaRecorder
          const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) audioChunksRef.current.push(event.data);
          };

          mediaRecorder.onstop = () => {
              // Only process if we actually detected speech
              if (!isSpeakingRef.current && audioChunksRef.current.length < 2) {
                  // No real speech detected — restart listening
                  if (conversationActive) setTimeout(() => startListeningCycle(), 200);
                  return;
              }
              isSpeakingRef.current = false;
              setVoiceStatus('processing');
              setIsListening(false);

              const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
              const reader = new FileReader();
              reader.readAsDataURL(audioBlob);
              reader.onloadend = async () => {
                  const base64Audio = reader.result.split(',')[1];
                  const payload = { type: 'audio', mimeType: 'audio/webm', content: base64Audio };
                  const responseText = await handleGeneralChat(payload, nodes);
                  addLog(`[AEGIS] ${responseText}`, 'ai');
                  
                  setVoiceStatus('speaking');
                  speakResponse(responseText, () => {
                      // After speaking, auto-resume listening if conversation still active
                      setVoiceStatus('listening');
                      setIsListening(true);
                      startListeningCycle();
                  });
              };
          };

          mediaRecorder.start(250); // timeslice for chunks
          setIsListening(true);
          setVoiceStatus('listening');

          // Voice Activity Detection loop
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const SPEECH_THRESHOLD = 30; // Volume level to detect speech
          const SILENCE_DURATION = 1500; // ms of silence before auto-transmit

          if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);

          vadIntervalRef.current = setInterval(() => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);
              const avgVolume = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

              if (avgVolume > SPEECH_THRESHOLD) {
                  // User is speaking
                  isSpeakingRef.current = true;
                  if (silenceTimerRef.current) {
                      clearTimeout(silenceTimerRef.current);
                      silenceTimerRef.current = null;
                  }

                  // If AEGIS was speaking, interrupt it
                  if (window.speechSynthesis.speaking) {
                      window.speechSynthesis.cancel();
                  }
              } else if (isSpeakingRef.current && !silenceTimerRef.current) {
                  // User stopped speaking — start silence timer
                  silenceTimerRef.current = setTimeout(() => {
                      // Silence confirmed — stop recording, auto-transmit
                      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
                      silenceTimerRef.current = null;
                      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                          mediaRecorderRef.current.stop();
                      }
                  }, SILENCE_DURATION);
              }
          }, 100);

      } catch (err) {
          addLog('[WARN] Microphone access denied.', 'warn');
          setIsListening(false);
          setVoiceStatus('idle');
          setConversationActive(false);
      }
  };

  const toggleConversation = () => {
      if (conversationActive) {
          // Shut down conversation
          setConversationActive(false);
          aegisCleanup();
          setIsListening(false);
          setVoiceStatus('idle');
      } else {
          // Start conversation
          setConversationActive(true);
          startListeningCycle();
      }
  };

  // Cleanup on unmount
  useEffect(() => {
      return () => aegisCleanup();
  }, []);

  // Sync conversationActive with cleanup
  useEffect(() => {
      if (!conversationActive) {
          aegisCleanup();
          setIsListening(false);
          setVoiceStatus('idle');
      }
  }, [conversationActive]);

  const speakResponse = (text, onEndCallback) => {
      if (!window.speechSynthesis) { onEndCallback?.(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = 0.85;
      utterance.rate = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = voices.find(v => v.lang.includes('en-GB')) || voices.find(v => v.lang.includes('en'));
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onend = () => onEndCallback?.();
      
      window.speechSynthesis.speak(utterance);
  };

  // ══════════════════════════════════════════════════
  // Text Chat Widget — Separate from Voice
  // ══════════════════════════════════════════════════
  const processChatPayload = async (payload) => {
      setAiChatLogs(prev => [...prev, { speaker: 'User', text: payload.content }]);
      setIsChatOpen(true);
      setAiChatLogs(prev => [...prev, { speaker: 'RIFT', text: '...' }]);
      if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });

      const responseText = await handleGeneralChat(payload, nodes);
      setAiChatLogs(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { speaker: 'RIFT', text: responseText };
          return updated;
      });

      setTimeout(() => {
          if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }, 100);
  };

  const handleChatTextSubmit = (e) => {
      if (e.key === 'Enter' && chatInputText.trim()) {
          const payload = { type: 'text', content: chatInputText.trim() };
          setChatInputText("");
          processChatPayload(payload);
      }
  };

  const getFinalPayload = async (autoText = null) => {
      if (imagePayload) return imagePayload; 
      let textContent = autoText || ingestText;

      const ghMatch = textContent.trim().match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
      if (ghMatch) {
          addLog(`[ROUTER] Detected GitHub Link. Rewriting to raw payload...`, 'ai');
          const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}/${ghMatch[4]}`;
          try {
             const res = await fetch(rawUrl);
             if (res.ok) {
                 textContent = await res.text();
                 addLog(`[ROUTER] Extracted payload natively from repository.`, 'ai');
             } else {
                 addLog(`[WARN] Failed to fetch. Passing link directly.`, 'warn');
             }
          } catch(e) {
             addLog(`[WARN] CORS block. Passing link directly.`, 'warn');
          }
      }
      return { type: 'text', content: textContent };
  };

  const typewriterTerminalProcess = (resolutionText, completionCallback) => {
      setLiveTerminalOutput("");
      let i = 0;
      const fullText = `[ SYSTEM ADMIN ] AI DevSecOps Resolution Hook Triggered...\n> Executing Patch Protocol\n> ${resolutionText}\n...`;
      
      const typeInterval = setInterval(() => {
          setLiveTerminalOutput(fullText.substring(0, i));
          i += 3; // speed
          if (i > fullText.length + 10) {
              clearInterval(typeInterval);
              setTimeout(() => {
                  setLiveTerminalOutput(null);
                  completionCallback();
              }, 600);
          }
      }, 30);
  };

  const handleIngest = async (autoText = null, explicitPayload = null) => {
     if ((!ingestText.trim() && !autoText) && !imagePayload && !explicitPayload) return;
     if (isProcessing) return;
     
     setIsProcessing(true);
     setWorkflowState(0);

     const payloadObj = explicitPayload || await getFinalPayload(autoText);
     addLog(`[AGENT_ROUTER] Initiating AI Payload Ingestion...`, 'ai');
     saveSnapshot(); // History 1: Before attack
     
     // Passes current custom `nodes` so AI knows what architecture exists!
     let analysis;
     try {
         analysis = await parseIncidentPayload(payloadObj, nodes);
     } catch(e) {
         analysis = { target: nodes[0]?.id || 'lb-1', type: 'Unclassified Error' };
     }
     const targetNodeId = analysis.target || (nodes[0]?.id || 'lb-1'); 
     const attackName = analysis.type || 'Custom Payload Signature';
     
     if (!autoText) {
        setIngestText("");
        setImagePayload(null);
        setUploadedFileIndicator(null);
     }
     
     // 2. Topology State update
     setWorkflowState(1);
     playAlertBeep();
     setNodes(nds => nds.map(node => node.id === targetNodeId ? { ...node, data: { ...node.data, status: 'critical' } } : node));
     setEdges(eds => eds.map(edge => edge.target === targetNodeId || edge.source === targetNodeId ? { ...edge, style: { stroke: '#ef4444', animation: 'dash 1s linear infinite' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' } } : edge));
     
     const targetNode = nodes.find(n => n.id === targetNodeId) || nodes[0];
     addLog(`[CRITICAL] Visual/Text trace maps to vector logic: ${attackName}. Architectural fault established at: ${targetNode?.data.label || 'Unknown'}.`, 'warn');
     
     setTimeout(async () => {
         setWorkflowState(2);
         addLog(`[AGENT_ENGINEER] Cross-referencing AI vector mapping against live DevSecOps logic...`, 'ai');
         
         const resolution = await generateAgentResolution(targetNode?.data.label || 'Unknown', attackName);
         
         // 3. DevSecOps Terminal Overlay
         typewriterTerminalProcess(resolution, () => {
             addLog(`[REPORT] ${resolution}`, 'report');
             setPatches(prev => [{ time: new Date().toLocaleTimeString(), node: targetNode?.data.label, attack: attackName, patch: resolution }, ...prev]);

             // 4. Resolve the node visually
             setNodes(nds => nds.map(node => node.id === targetNodeId ? { ...node, data: { ...node.data, status: 'healthy' } } : node));
             setEdges(eds => eds.map(edge => edge.target === targetNodeId || edge.source === targetNodeId ? { ...edge, style: { stroke: '#34d399' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#34d399' } } : edge));
             setWorkflowState(3);
             playSuccessChirp();
             addLog(`[SYS] Automated configuration applied. Pipeline validated.`, 'ai');
             
             saveSnapshot(); // History 2: Resolution applied
             
             setTimeout(() => {
                 setEdges(initialEdges); // Revert to idle edges
                 setIsProcessing(false);
                 saveSnapshot();
             }, 2000);
         });
         
     }, 2000);
  };

  const handleVcrChange = (e) => {
      const idx = parseInt(e.target.value, 10);
      if (idx === temporalHistory.length - 1) {
          setVcrIndex(-1); // Live mode
      } else {
          setVcrIndex(idx);
      }
  };

  const getActiveGraph = () => {
      if (vcrIndex === -1) return { n: nodes, e: edges };
      if (!temporalHistory[vcrIndex]) return { n: nodes, e: edges };
      return { n: temporalHistory[vcrIndex].snapshot.nodes, e: temporalHistory[vcrIndex].snapshot.edges };
  };
  
  const currentGraph = getActiveGraph();

  const handleDeleteNode = useCallback((nodeId) => {
    if (vcrIndex !== -1) return; // Disallow delete in historical playback
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    saveSnapshot();
    addLog(`[UI] Removed architecture node: ${nodeId}`, 'ai');
  }, [vcrIndex, saveSnapshot, addLog]);

  const mapNodes = currentGraph.n.map(n => ({
      ...n,
      data: { ...n.data, onDelete: handleDeleteNode }
  }));

  return (
    <div className={`dashboard-layout light-glass ${vcrIndex !== -1 ? 'vcr-mode' : ''}`}>
      {showApiKeyModal && (
        <div className="modal-overlay glass-panel" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
           <div className="panel glass-panel" style={{ width: '450px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid #334155' }}>
              <h2 style={{ margin: 0, color: '#38bdf8' }}>Custom AI Authorization Required</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.4' }}>
                 The edge deployment API quotas have been exhausted or an unclassified error occurred. <br/><br/>
                 Please provide your personal <b>Gemini API Key</b> to seamlessly resume operations. Your key is stored strictly within your browser's local sandbox layer and is naturally obfuscated.
              </p>
              <input 
                 type="password" 
                 value={modalInputKey} 
                 onChange={e => setModalInputKey(e.target.value)} 
                 placeholder="AIzaSyB..." 
                 className="ingest-box" 
                 style={{ height: '40px', background: 'rgba(0,0,0,0.3)', border: '1px solid #475569', color: '#fff', padding: '0 1rem' }} 
              />
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <button onClick={saveLocalApiKey} className="cmd-btn generic-btn primary-btn" style={{ flex: 1 }}>SAVE LOCALLY</button>
                  <button onClick={() => setShowApiKeyModal(false)} className="cmd-btn generic-btn" style={{ flex: 1 }}>BYPASS</button>
              </div>
           </div>
        </div>
      )}
      <div className="nav-bar glass-panel">
         <h1 className="logo">R I F T <span>&#x25B2;</span></h1>
         <div className="center-actions">
            <button className={`chaos-btn ${isChaosMode ? 'active' : ''}`} onClick={() => setIsChaosMode(!isChaosMode)}>
               {isChaosMode ? '▇ CHAOS ACTIVE' : '▶ ENABLE CHAOS MODE'}
            </button>
            <button className="generic-btn dark-toggle-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{marginLeft: '10px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '100px', cursor: 'pointer', padding: '6px 14px', fontSize: '11px', fontWeight: 'bold'}}>
               {theme === 'light' ? '🌙 CYBER-NIGHTS' : '☀️ DAYLIGHT'}
            </button>
         </div>
         <div className="tabs">
            <button className={activeTab === 'topology' ? 'active' : ''} onClick={() => setActiveTab('topology')}>Architecture</button>
            <button className={activeTab === 'logs' ? 'active' : ''} onClick={() => setActiveTab('logs')}>Threat Logs ({logs.length})</button>
            <button className={activeTab === 'patches' ? 'active' : ''} onClick={() => setActiveTab('patches')}>Resolution Registry ({patches.length})</button>
         </div>
      </div>

      <div className="main-content">
        {activeTab === 'topology' && (
          <>
            <div className="sidebar-group">
                <div className="panel sidebar-left glass-panel">
                  <h2>DATA INGESTION</h2>
                  <div className="controls">
                     <p className="desc onboarding">
                       Import raw code, system telemetry, JSON fault lines, GitHub file blobs, or terminal error screenshots.
                     </p>
                     
                     <textarea 
                       className="ingest-box" 
                       rows="4" 
                       placeholder="e.g. Paste GitHub link, raw textual stack-trace, or JSON log..."
                       value={ingestText}
                       onChange={e => setIngestText(e.target.value)}
                       disabled={isProcessing || imagePayload !== null || vcrIndex !== -1 || isChaosMode}
                     />

                     <div className="file-upload-wrapper" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                           <label className="file-upload-btn" style={{ margin: 0 }}>
                              + ATTACH IMAGE / LOG
                              <input type="file" accept=".txt,.log,.json,image/*" onChange={handleFileUpload} disabled={isProcessing || vcrIndex !== -1 || isChaosMode} />
                           </label>
                        </div>
                        {uploadedFileIndicator && <span className="attached-file">{uploadedFileIndicator}</span>}
                     </div>
                     
                     <button 
                       className={`cmd-btn generic-btn primary-btn ${isProcessing || vcrIndex !== -1 || isChaosMode ? 'disabled' : ''}`} 
                       onClick={() => handleIngest()}
                       disabled={isProcessing || vcrIndex !== -1 || isChaosMode}>
                       {isChaosMode ? 'Chaos Pilot Active' : (isProcessing ? 'Processing Payload...' : 'Send to RIFT Interpreter')}
                     </button>
                  </div>
                  
                  <div className="workflow-tracker">
                     <h3>AI PROTOCOL STATUS</h3>
                     <ul className="steps">
                         <li className={workflowState >= 1 ? 'active' : ''}>
                             <div className="checkbox">{workflowState >= 1 ? '✓' : ''}</div>
                             <span>1. Topology Compromised</span>
                         </li>
                         <li className={workflowState >= 2 ? 'active ai' : ''}>
                             <div className="checkbox">{workflowState >= 2 ? '✓' : ''}</div>
                             <span>2. Gemini Agent Executing</span>
                         </li>
                         <li className={workflowState >= 3 ? 'active green' : ''}>
                             <div className="checkbox">{workflowState >= 3 ? '✓' : ''}</div>
                             <span>3. Infrastructure Secured</span>
                         </li>
                     </ul>
                  </div>
                </div>

                <div className="panel palette glass-panel">
                  <h2>NODE PALETTE</h2>
                  <div className="palette-desc">Drag to architecture to expand telemetry.</div>
                  <div className="dndnode input" onDragStart={(event) => onDragStart(event, 'gateway')} draggable>API Gateway</div>
                  <div className="dndnode" onDragStart={(event) => onDragStart(event, 'worker')} draggable>Worker Instance</div>
                  <div className="dndnode output" onDragStart={(event) => onDragStart(event, 'database')} draggable>Database Storage</div>
                  <div className="dndnode" onDragStart={(event) => onDragStart(event, 's3-bucket')} draggable>S3 Bucket</div>
                  <div className="dndnode" onDragStart={(event) => onDragStart(event, 'kafka-queue')} draggable>Kafka Event Queue</div>
                  <div className="dndnode" onDragStart={(event) => onDragStart(event, 'redis-cache')} draggable>Redis Cache</div>
                  <div className="dndnode input" onDragStart={(event) => onDragStart(event, 'ui-frontend')} draggable>Web Frontend UI</div>
                </div>
            </div>

            <div className="center-group">
                <div className="matrix-center glass-panel" ref={reactFlowWrapper}>
                  {liveTerminalOutput && (
                      <div className="live-terminal-overlay">
                          <pre>{liveTerminalOutput}</pre>
                      </div>
                  )}
                  {vcrIndex !== -1 && (
                      <div className="vcr-badge">● HISTORICAL PLAYBACK (T-{temporalHistory.length - vcrIndex - 1})</div>
                  )}
                  <RiftMap 
                      nodes={mapNodes} 
                      edges={currentGraph.e} 
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onDrop={onDrop}
                      onDragOver={onDragOver}
                 />
                </div>
                
                {temporalHistory.length > 1 && (
                    <div className="vcr-scrubber glass-panel">
                       <span>&#x23EA; HISTORY</span>
                       <input 
                          type="range" 
                          min="0" 
                          max={temporalHistory.length - 1} 
                          value={vcrIndex === -1 ? temporalHistory.length - 1 : vcrIndex}
                          onChange={handleVcrChange}
                       />
                       <span>LIVE {vcrIndex === -1 ? '●' : '○'}</span>
                    </div>
                )}
            </div>

            <div className="panel sidebar-right glass-panel">
               <h2>LIVE TERMINAL</h2>
               <div className="terminal-feed">
                  {logs.map((log, i) => (
                      <div key={i} className={`log-entry ${log.type}`}>
                          <span className="time">{log.time}</span>
                          <span className="msg">{log.msg}</span>
                      </div>
                  ))}
                  <div ref={logsEndRef} />
               </div>
            </div>
          </>
        )}

        {/* Other tabs remain basically the same */}
        {activeTab === 'logs' && (
           <div className="panel full-page full-terminal glass-panel">
               <h2>HISTORICAL SYSTEM LOGS</h2>
               <div className="terminal-feed large">
                  {logs.map((log, i) => (
                      <div key={i} className={`log-entry ${log.type}`}>
                          <span className="time">{log.time}</span>
                          <span className="msg">{log.msg}</span>
                      </div>
                  ))}
                  <div ref={logsEndRef} />
               </div>
           </div>
        )}

        {activeTab === 'patches' && (
           <div className="panel full-page glass-panel">
               <h2>AI RESOLUTION REGISTRY</h2>
               {patches.length === 0 ? (
                  <p className="empty-state">No automated remediation patches generated yet.</p>
               ) : (
                 <div className="patch-list">
                    {patches.map((p, i) => (
                       <div key={i} className="patch-card">
                          <div className="patch-header">
                              <span className="node-badge">{p.node}</span>
                              <span className="time">{p.time}</span>
                          </div>
                          <h4>ATTACK VECTOR: {p.attack}</h4>
                          <p className="resolution-text">{p.patch}</p>
                          <button onClick={() => exportPDF(p)} className="cmd-btn generic-btn" style={{marginTop: '1rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)'}}>
                             EXPORT REPORT TO PDF
                          </button>
                       </div>
                    ))}
                 </div>
               )}
           </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* AEGIS — Voice Command Orb (Bottom-Left)          */}
      {/* ══════════════════════════════════════════════════ */}
      <div className="aegis-voice-orb" onClick={toggleConversation} style={{
          position: 'fixed', bottom: '28px', left: '28px', zIndex: 9999, cursor: 'pointer'
      }}>
          {/* Dynamic Pulse Rings */}
          {voiceStatus === 'listening' && <>
              <span className="aegis-ring aegis-ring-1" />
              <span className="aegis-ring aegis-ring-2" />
              <span className="aegis-ring aegis-ring-3" />
          </>}
          {voiceStatus === 'processing' && <span className="aegis-ring aegis-ring-processing" />}
          {voiceStatus === 'speaking' && <>
              <span className="aegis-ring aegis-ring-speaking-1" />
              <span className="aegis-ring aegis-ring-speaking-2" />
          </>}

          <div className={`aegis-core ${voiceStatus}`} style={{
              width: '56px', height: '56px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
              position: 'relative', zIndex: 2,
              background: voiceStatus === 'listening' ? 'linear-gradient(135deg, #ef4444, #f97316)' 
                        : voiceStatus === 'processing' ? 'linear-gradient(135deg, #f59e0b, #eab308)' 
                        : voiceStatus === 'speaking' ? 'linear-gradient(135deg, #22c55e, #10b981)' 
                        : conversationActive ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' 
                        : 'linear-gradient(135deg, var(--accent-blue), #6366f1)',
              boxShadow: voiceStatus === 'listening' ? '0 0 30px rgba(239,68,68,0.5)' 
                        : voiceStatus === 'speaking' ? '0 0 30px rgba(34,197,94,0.5)' 
                        : conversationActive ? '0 0 20px rgba(99,102,241,0.4)' 
                        : '0 8px 24px rgba(0,0,0,0.3)',
              transition: 'all 0.3s ease'
          }}>
              <span style={{ fontSize: '20px', lineHeight: 1, color: '#fff' }}>{
                  voiceStatus === 'listening' ? '◉' 
                  : voiceStatus === 'processing' ? '⟳' 
                  : voiceStatus === 'speaking' ? '◈' 
                  : conversationActive ? '◎' 
                  : '⎔'
              }</span>
          </div>

          <div style={{
              position: 'absolute', bottom: '-22px', left: '50%', transform: 'translateX(-50%)',
              fontSize: '9px', fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)',
              whiteSpace: 'nowrap', textTransform: 'uppercase'
          }}>
              {voiceStatus === 'idle' && !conversationActive ? 'AEGIS' 
               : voiceStatus === 'listening' ? 'LISTENING...' 
               : voiceStatus === 'processing' ? 'THINKING...' 
               : voiceStatus === 'speaking' ? 'SPEAKING...' 
               : 'TAP TO END'}
          </div>
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* Text Chat Widget (Bottom-Right)                  */}
      {/* ══════════════════════════════════════════════════ */}
      <div className={`floating-chat-widget glass-panel ${isChatOpen ? 'open' : 'closed'}`} style={{
          position: 'fixed', bottom: isChatOpen ? '20px' : '-420px', right: '20px', width: '360px', height: '420px',
          zIndex: 9998, transition: 'bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border-color)', borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)', overflow: 'hidden'
      }}>
          <div style={{
              padding: '12px 16px', background: 'rgba(0,0,0,0.35)', borderBottom: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
          }} onClick={() => setIsChatOpen(false)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-green)', display: 'inline-block' }} />
                  <strong style={{ fontSize: '12px', color: 'var(--text-primary)', letterSpacing: '1.5px' }}>RIFT AI ASSIST</strong>
              </div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>✕</span>
          </div>
          
          <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {aiChatLogs.map((msg, i) => (
                  <div key={i} style={{ 
                      alignSelf: msg.speaker === 'User' ? 'flex-end' : 'flex-start',
                      background: msg.speaker === 'User' ? 'var(--accent-blue)' : 'rgba(0,0,0,0.25)',
                      color: msg.speaker === 'User' ? '#fff' : 'var(--text-primary)',
                      padding: '9px 13px', borderRadius: msg.speaker === 'User' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      maxWidth: '82%', fontSize: '12.5px', lineHeight: '1.55'
                  }}>
                      {msg.text}
                  </div>
              ))}
              <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.15)' }}>
              <input 
                  type="text" 
                  value={chatInputText}
                  onChange={(e) => setChatInputText(e.target.value)}
                  onKeyDown={handleChatTextSubmit}
                  placeholder="Ask RIFT anything..."
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '9px 14px', borderRadius: '100px', outline: 'none', fontSize: '12.5px' }}
              />
          </div>
      </div>

      {!isChatOpen && (
          <button 
             className="glass-panel chat-fab"
             onClick={() => setIsChatOpen(true)}
             style={{
                 position: 'fixed', bottom: '22px', right: '22px', zIndex: 9998,
                 width: '50px', height: '50px', borderRadius: '50%', border: '1px solid var(--border-color)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', cursor: 'pointer',
                 boxShadow: '0 8px 20px rgba(0,0,0,0.25)'
             }}>
             💬
          </button>
      )}

    </div>
  );
}
