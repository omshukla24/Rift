import React, { memo } from 'react';
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Premium Node
const RiftNode = memo(({ data, id }) => {
  const isCritical = data.status === 'critical';
  const isHealthy = data.status === 'healthy';

  return (
    <div className={`rift-node ${isCritical ? 'critical' : isHealthy ? 'healthy' : 'idle'}`}>
       <div className="node-header">
          <div className="node-header-left">
             <div className={`status-dot ${isCritical ? 'pulse-red' : isHealthy ? 'pulse-green' : 'pulse-blue'}`}></div>
             <span className="node-title">{data.label}</span>
          </div>
          {data.onDelete && (
             <button className="node-delete-btn" onClick={() => data.onDelete(id)} title="Remove Node">&times;</button>
          )}
       </div>
       <div className="node-body">
          <span className="ip">{data.ip}</span>
          <span className="type">{data.type}</span>
       </div>
    </div>
  );
});

const nodeTypes = {
  rift: RiftNode,
};

export default function RiftMap({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, onDragOver }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#94a3b8" gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
