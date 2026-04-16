import asyncio
import websockets
import psutil
import json
import time

async def telemetry_loop(websocket):
    print("RIFT UI Connected. Streaming raw telemetry...")
    try:
        # Initialize basic CPU measurement to avoid 0.0 response at start
        psutil.cpu_percent(interval=None)
        
        while True:
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory().percent
            
            # Basic entropy generation for the matrix based on actual live hardware stats
            pids_count = len(psutil.pids())
            
            payload = {
                "cpu": cpu,
                "mem": mem,
                "sys_entropy": pids_count,
                "timestamp": time.time()
            }
            
            await websocket.send(json.dumps(payload))
            await asyncio.sleep(1/60) # High frequency 60Hz stream
            
    except websockets.exceptions.ConnectionClosed:
        print("RIFT UI Connection Severed.")

async def main():
    print("Initializing RIFT Systems Daemon on :8765...")
    async with websockets.serve(telemetry_loop, "localhost", 8765):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
