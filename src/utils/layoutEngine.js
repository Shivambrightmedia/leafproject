import * as d3 from 'd3-force';
import { quadtree } from 'd3-quadtree';

const TRUNK_CENTER = { x: 610, y: 700 };
const MIN_RADIUS = 150;
const MAX_RADIUS = 600;
const LEAF_W = 76 + 25; // Leaf width + 25px spacing
const LEAF_H = 40 + 20; // Leaf height + 20px spacing
const LEAF_RADIUS = Math.max(LEAF_W, LEAF_H) / 2; // Approximation for broad phase

// Hash function to get deterministic values
function hashText(text) {
  return [...String(text)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

// Bounding box collision force for d3-force
function forceCapsuleCollide() {
  let nodes;
  
  function force(alpha) {
    const tree = quadtree(nodes, d => d.x, d => d.y);
    
    for (let i = 0; i < nodes.length; ++i) {
      const node = nodes[i];
      const r = LEAF_RADIUS;
      const nx1 = node.x - r, ny1 = node.y - r;
      const nx2 = node.x + r, ny2 = node.y + r;
      
      tree.visit((quad, x1, y1, x2, y2) => {
        if (!quad.length) {
          do {
            const current = quad.data;
            if (current !== node) {
              const dx = node.x - current.x;
              const dy = node.y - current.y;
              const absX = Math.abs(dx);
              const absY = Math.abs(dy);
              
              // Capsule / Rect bounding box intersection check
              const minDx = LEAF_W;
              const minDy = LEAF_H;
              
              if (absX < minDx && absY < minDy) {
                // Collision detected, apply repulsion
                let lx = absX - minDx;
                let ly = absY - minDy;
                
                // Repel along the shortest overlapping axis
                if (lx > ly) {
                  lx = (lx * (dx > 0 ? 1 : -1)) * alpha * 0.5;
                  node.x -= lx;
                  current.x += lx;
                } else {
                  ly = (ly * (dy > 0 ? 1 : -1)) * alpha * 0.5;
                  node.y -= ly;
                  current.y += ly;
                }
              }
            }
          } while ((quad = quad.next));
        }
        return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
      });
    }
  }

  force.initialize = function(_nodes) {
    nodes = _nodes;
  };

  return force;
}

// Force to pull leaves back to their preferred radial branch
function forceRadialBranch() {
  let nodes;
  
  function force(alpha) {
    for (let i = 0; i < nodes.length; ++i) {
      const node = nodes[i];
      const targetAngle = node.preferredAngle;
      
      const dx = node.x - TRUNK_CENTER.x;
      const dy = node.y - TRUNK_CENTER.y;
      const dist = Math.hypot(dx, dy);
      
      // Pull distance slightly out if too close, but mostly enforce angle
      const currentAngle = Math.atan2(dy, dx);
      let angleDiff = targetAngle - currentAngle;
      
      // Normalize angle diff
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      
      const correctAngle = currentAngle + angleDiff * alpha * 0.5;
      
      const targetX = TRUNK_CENTER.x + Math.cos(correctAngle) * dist;
      const targetY = TRUNK_CENTER.y + Math.sin(correctAngle) * dist;
      
      node.vx += (targetX - node.x) * alpha * 0.2;
      node.vy += (targetY - node.y) * alpha * 0.2;
      
      // Push out if too close to trunk
      if (dist < MIN_RADIUS) {
        node.vx += (dx / dist) * (MIN_RADIUS - dist) * alpha * 0.1;
        node.vy += (dy / dist) * (MIN_RADIUS - dist) * alpha * 0.1;
      }
      
      // Pull in if too far
      if (dist > MAX_RADIUS) {
        node.vx += (dx / dist) * (MAX_RADIUS - dist) * alpha * 0.1;
        node.vy += (dy / dist) * (MAX_RADIUS - dist) * alpha * 0.1;
      }
    }
  }

  force.initialize = function(_nodes) {
    nodes = _nodes;
  };

  return force;
}

export function arrangeLeavesRadial(leaves, salt = "") {
  if (!leaves || leaves.length === 0) return [];

  // Create physics nodes
  const nodes = leaves.map((leaf, index) => {
    const seed = hashText(`${leaf.id || leaf.name}-${salt}`);
    
    // Spread in arc from -80 to +80 degrees (straight up is -90 degrees or -PI/2)
    // 80 degrees = 80 * PI / 180 = 1.396 rad
    // Range: -PI/2 - 1.396 to -PI/2 + 1.396
    const arcSpread = 80 * (Math.PI / 180);
    const angleRatio = (seed % 1000) / 1000; // 0 to 1
    const preferredAngle = -Math.PI/2 - arcSpread + (arcSpread * 2 * angleRatio);
    
    const preferredRadius = MIN_RADIUS + ((seed % 500) / 500) * (MAX_RADIUS - MIN_RADIUS);

    // Initial placement (could overlap)
    const initialX = TRUNK_CENTER.x + Math.cos(preferredAngle) * preferredRadius;
    const initialY = TRUNK_CENTER.y + Math.sin(preferredAngle) * preferredRadius;
    
    // Rotation roughly matches the branch angle
    const angleDeg = preferredAngle * (180 / Math.PI);
    // Add 90 because leaf is horizontal by default
    const rotate = angleDeg + 90 + ((seed % 40) - 20); 

    return {
      ...leaf,
      preferredAngle,
      preferredRadius,
      x: initialX,
      y: initialY,
      rotate
    };
  });

  // Run a headless static simulation to resolve collisions
  const simulation = d3.forceSimulation(nodes)
    .force("collide", forceCapsuleCollide())
    .force("radialBranch", forceRadialBranch())
    .stop();

  // Tick the simulation 150 times to settle it
  simulation.tick(150);

  // Return the resolved positions
  return nodes.map(node => ({
    ...node,
    x: Math.round(node.x),
    y: Math.round(node.y),
    rotate: Math.round(node.rotate)
  }));
}
