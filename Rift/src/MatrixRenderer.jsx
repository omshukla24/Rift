import React, { useEffect, useRef, useState } from 'react';
import { requestAntibodyPath } from './lib/gemini';

export default function MatrixRenderer({ onTelemetryUpdate, onLog, onIncident, anomalyTrigger, onWorkflowStep }) {
  const canvasRef = useRef(null);
  const anomalyLock = useRef(false);
  const artificialSpike = useRef(false);
  
  useEffect(() => {
     if (anomalyTrigger) {
         artificialSpike.current = true;
         onLog("[WARN] Artificial memory threshold spike injected...");
         setTimeout(() => { artificialSpike.current = false; }, 3000); 
     }
  }, [anomalyTrigger]);

  useEffect(() => {
    let ws = new WebSocket("ws://localhost:8765");
    let currentTelem = { cpu: 0, mem: 0, sys_entropy: 0 };
    ws.onmessage = (e) => {
      let data = JSON.parse(e.data);
      currentTelem = data;
      onTelemetryUpdate(data);
    };

    let gl;
    let program;
    let texture;
    let wasmExports;
    let gridView;
    let animFrame;

    async function init() {
      try {
        const response = await fetch('/release.wasm');
        const buffer = await response.arrayBuffer();
        
        const module = await WebAssembly.instantiate(buffer, {
          env: { abort: () => console.log("WASM Abort!") }
        });
        wasmExports = module.instance.exports;
        
        const ptr = wasmExports.getGridPtr();
        gridView = new Uint8Array(wasmExports.memory.buffer, ptr, 256 * 256 * 4);

        const canvas = canvasRef.current;
        gl = canvas.getContext('webgl');
        
        const vsSource = `
          attribute vec2 a_position;
          varying vec2 v_texcoord;
          void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texcoord = (a_position + 1.0) / 2.0; 
            v_texcoord.y = 1.0 - v_texcoord.y; 
          }
        `;
        
        const fsSource = `
          precision highp float;
          varying vec2 v_texcoord;
          uniform sampler2D u_texture;
          
          void main() {
            vec2 uv = v_texcoord;
            vec4 rawData = texture2D(u_texture, uv);
            
            vec2 gridUV = fract(uv * 256.0);
            float border = 0.15;
            float isVBorder = step(gridUV.x, border) + step(1.0 - gridUV.x, border);
            float isHBorder = step(gridUV.y, border) + step(1.0 - gridUV.y, border);
            float isBorder = clamp(isVBorder + isHBorder, 0.0, 1.0);
            
            float cellIntensity = 1.0 - (isBorder * 0.85); 
            
            vec3 bg = vec3(0.01, 0.02, 0.05); 
            
            float anomaly = rawData.r;
            float idleBlue = rawData.b;
            float hunter = rawData.g;
            
            vec3 idleColor = vec3(0.0, 0.4, 1.0) * idleBlue * 0.8;
            vec3 anomalyColor = vec3(1.0, 0.1, 0.2) * anomaly * 1.5;
            vec3 hunterColor = vec3(0.8, 1.0, 1.0) * hunter * 2.0;
            
            vec3 combined = idleColor + anomalyColor + hunterColor;
            vec3 finalColor = bg + (combined * cellIntensity);
            
            float scanline = sin(uv.y * 1000.0) * 0.04;
            finalColor -= scanline;
            float dist = distance(uv, vec2(0.5));
            finalColor *= smoothstep(0.8, 0.3, dist); 
            
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);

        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.useProgram(program);

        const bufferData = new Float32Array([
           -1, -1, 1, -1, -1,  1,
           -1,  1, 1, -1, 1,  1,
        ]);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.STATIC_DRAW);

        const aPosition = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        
        onLog("[SYS] Visual Matrix Subsystems Online.");
        renderLoop();
      } catch (err) {
        console.error("WASM/WebGL err:", err);
      }
    }

    function renderLoop() {
      let actualCpu = currentTelem.cpu;
      if (artificialSpike.current) actualCpu = 100;
        
      wasmExports.updateGrid(actualCpu, currentTelem.mem, currentTelem.sys_entropy || 0);
      let anomalies = wasmExports.convolutionPass();
      wasmExports.updateHunters();

      if (anomalies > 120 && !anomalyLock.current) {
          anomalyLock.current = true;
          onWorkflowStep(1);
          onLog(`[WARN] Threat Threshold Breached: ${anomalies} cells corrupted. Requesting AI Intervention...`);
          
          requestAntibodyPath(anomalies).then(res => {
              onWorkflowStep(2);
              wasmExports.spawnAntibodies(res.strikeX, res.strikeY);
              onIncident(anomalies, res.strikeX, res.strikeY);
              
              setTimeout(() => { 
                anomalyLock.current = false; 
                onWorkflowStep(3);
                onLog("[SYS] Local Grid Stabilized.");
              }, 4000);
          });
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, gridView);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      
      animFrame = requestAnimationFrame(renderLoop);
    }

    init();

    return () => {
      ws.close();
      cancelAnimationFrame(animFrame);
    };
    // eslint-disable-next-line
  }, []);

  return (
    <div className="matrix-wrapper">
       <div className="corner-tl"></div><div className="corner-tr"></div>
       <div className="corner-bl"></div><div className="corner-br"></div>
       <canvas ref={canvasRef} className="rift-canvas" />
    </div>
  );
}
