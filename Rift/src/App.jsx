import React, { useState, useEffect, useRef, useCallback } from 'react';
import RiftMap from './RiftMap';
import { parseIncidentPayload, generateAgentResolution } from './lib/gemini';
import { MarkerType, addEdge, applyNodeChanges, applyEdgeChanges } from 'reactflow';

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

  const [ingestText, setIngestText] = useState("");
  const [uploadedFileIndicator, setUploadedFileIndicator] = useState(null);
  const [imagePayload, setImagePayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // New features state
  const [isChaosMode, setIsChaosMode] = useState(false);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState(null);
  const [temporalHistory, setTemporalHistory] = useState([{ time: Date.now(), snapshot: { nodes: initialNodes, edges: initialEdges } }]);
  const [vcrIndex, setVcrIndex] = useState(-1); // -1 means live current state

  const logsEndRef = useRef(null);
  const reactFlowWrapper = useRef(null);

  const addLog = useCallback((msg, type = '') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
  }, []);

  useEffect(() => {
    if (activeTab === 'logs' || activeTab === 'topology') {
       logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

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
          reader.onloadend = () => setIngestText(reader.result);
          reader.readAsText(file);
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

  const handleIngest = async (autoText = null) => {
     if ((!ingestText.trim() && !autoText) && !imagePayload) return;
     if (isProcessing) return;
     
     setIsProcessing(true);
     setWorkflowState(0);
     addLog(`[AGENT_ROUTER] Initiating AI Payload Ingestion...`, 'ai');
     saveSnapshot(); // History 1: Before attack
     
     const finalPayload = await getFinalPayload(autoText);
     
     // Passes current custom `nodes` so AI knows what architecture exists!
     const analysis = await parseIncidentPayload(finalPayload, nodes);
     const targetNodeId = analysis.target || (nodes[0]?.id || 'lb-1'); 
     const attackName = analysis.type || 'Custom Payload Signature';
     
     if (!autoText) {
        setIngestText("");
        setImagePayload(null);
        setUploadedFileIndicator(null);
     }
     
     // 2. Topology State update
     setWorkflowState(1);
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
      <div className="nav-bar glass-panel">
         <h1 className="logo">R I F T <span>&#x25B2;</span></h1>
         <div className="center-actions">
            <button className={`chaos-btn ${isChaosMode ? 'active' : ''}`} onClick={() => setIsChaosMode(!isChaosMode)}>
               {isChaosMode ? '▇ CHAOS ACTIVE' : '▶ ENABLE CHAOS MODE'}
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

                     <div className="file-upload-wrapper">
                        <label className="file-upload-btn">
                           + ATTACH IMAGE / LOG
                           <input type="file" accept=".txt,.log,.json,image/*" onChange={handleFileUpload} disabled={isProcessing || vcrIndex !== -1 || isChaosMode} />
                        </label>
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
                       </div>
                    ))}
                 </div>
               )}
           </div>
        )}
      </div>
    </div>
  );
}
