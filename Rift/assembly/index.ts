// assembly/index.ts
export const width: i32 = 256;
export const height: i32 = 256;

const grid = new Uint8Array(width * height * 4);
const newGrid = new Uint8Array(width * height * 4);

const hunters = new Int32Array(width * height);
const newHunters = new Int32Array(width * height);

export function getGridPtr(): usize {
  return grid.dataStart;
}

let seed: i32 = 12345;
function rand(): f32 {
  seed = (seed * 1664525 + 1013904223) | 0;
  return f32(seed & 0xFFFFFF) / f32(0xFFFFFF);
}

export function updateGrid(cpu: f32, _mem: f32, sys_entropy: f32): void {
  for (let i = 0; i < width * height; i++) {
    let r = grid[i * 4 + 0];
    let g = grid[i * 4 + 1];
    let b = grid[i * 4 + 2];

    // Slower decay for more explosive blooms
    if (r > 0) grid[i * 4 + 0] = r - 1;
    if (g > 0) grid[i * 4 + 1] = g - 1;
    
    if (b < 80) grid[i * 4 + 2] = b + 1;
    else if (b > 100) grid[i * 4 + 2] = b - 1;

    grid[i * 4 + 3] = 255; 
  }

  // Increased spike injection exponentially when load hits 100%
  let spike_chance = cpu / 100.0;
  let iterations = cpu >= 99.0 ? 10 : (rand() < spike_chance ? 1 : 0);
  
  for (let s = 0; s < iterations; s++) {
     let x = i32(rand() * f32(width));
     let y = i32(rand() * f32(height));
     let idx = y * width + x;
     grid[idx * 4 + 0] = 255; 
     grid[idx * 4 + 1] = 0;
     grid[idx * 4 + 2] = 0;
  }

  if (sys_entropy > 0 && rand() < 0.1) {
    let x = i32(rand() * f32(width));
    let y = i32(rand() * f32(height));
    let idx = y * width + x;
    grid[idx * 4 + 0] = 255; 
    grid[idx * 4 + 1] = 255;
    grid[idx * 4 + 2] = 255;
  }
}

export function convolutionPass(): i32 {
   let anomaly_severity = 0;
   
   for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
         let idx = y * width + x;
         let r_sum = 0;
         
         for (let dy = -1; dy <= 1; dy++) {
             for (let dx = -1; dx <= 1; dx++) {
                 let n_idx = (y + dy) * width + (x + dx);
                 r_sum += grid[n_idx * 4 + 0];
             }
         }
         
         // Spread aggressively when only 2 neighbors are fully red (255 * 2 = 510)
         if (r_sum > 500 && grid[idx * 4 + 0] < 250) {
            newGrid[idx * 4 + 0] = 255; 
            newGrid[idx * 4 + 1] = 0;
            newGrid[idx * 4 + 2] = 0;
            newGrid[idx * 4 + 3] = 255;
            anomaly_severity += 1;
         } else {
            newGrid[idx * 4 + 0] = grid[idx * 4 + 0];
            newGrid[idx * 4 + 1] = grid[idx * 4 + 1];
            newGrid[idx * 4 + 2] = grid[idx * 4 + 2];
            newGrid[idx * 4 + 3] = grid[idx * 4 + 3];
         }
         
         if (newGrid[idx * 4 + 0] > 100) anomaly_severity++; // Count all intense reds
      }
   }

   for (let i = 0; i < width * height * 4; i++) {
     grid[i] = newGrid[i];
   }
   
   return anomaly_severity; 
}

export function spawnAntibodies(targetX: i32, targetY: i32): void {
   for(let i=0; i<30; i++) {
       let hx = i32(rand() * f32(width));
       let hy = i32(rand() > 0.5 ? height - 1 : 0);
       let idx = hy * width + hx;
       hunters[idx] = targetY * width + targetX;
   }
}

export function updateHunters(): void {
   for (let i = 0; i < width * height; i++) {
     newHunters[i] = 0;
   }
   
   for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
         let idx = y * width + x;
         let target = hunters[idx];
         
         if (target > 0) {
             let tx = target % width;
             let ty = target / width;
             
             let nx = x;
             let ny = y;
             if (nx < tx) nx += 2; // Move faster
             else if (nx > tx) nx -= 2;
             
             if (ny < ty) ny += 2;
             else if (ny > ty) ny -= 2;
             
             let n_idx = ny * width + nx;
             if (Math.abs(nx - tx) <= 2 && Math.abs(ny - ty) <= 2) {
                // target reached -> clean massive area
                for (let cdy = -15; cdy <= 15; cdy++) {
                   for (let cdx = -15; cdx <= 15; cdx++) {
                       let cx = nx + cdx;
                       let cy = ny + cdy;
                       if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
                          let c_idx = cy * width + cx;
                          grid[c_idx * 4 + 0] = 0; 
                          grid[c_idx * 4 + 1] = 255; 
                          grid[c_idx * 4 + 2] = 255;
                       }
                   }
                }
             } else {
                newHunters[n_idx] = target;
                
                grid[n_idx * 4 + 0] = 255;
                grid[n_idx * 4 + 1] = 255;
                grid[n_idx * 4 + 2] = 255;
             }
         }
      }
   }
   for (let i = 0; i < width * height; i++) {
     hunters[i] = newHunters[i];
   }
}
