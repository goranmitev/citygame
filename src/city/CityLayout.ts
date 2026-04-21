import { createRNG, randRange, randInt } from '../utils/random';

export interface BlockDef {
  /** Block bounding box in world coords (x, z) */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Building plots inside this block */
  plots: PlotDef[];
  /** Whether this block is a park (no buildings) */
  isPark?: boolean;
}

export interface PlotDef {
  x: number;
  z: number;
  width: number;
  depth: number;
  floors: number;
}

export interface StreetSegment {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface IntersectionDef {
  px: number;   // world X of sign post (center of NW corner sidewalk tile)
  pz: number;   // world Z of sign post
  vIdx: number; // index into vStreetNames
  hIdx: number; // index into hStreetNames
}

export interface CityLayoutData {
  blocks: BlockDef[];
  streets: StreetSegment[];
  sidewalks: StreetSegment[];
  totalWidth: number;
  totalDepth: number;
  vStreetNames: string[];
  hStreetNames: string[];
  intersections: IntersectionDef[];
}

const STREET_WORDS = [
  'Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'River', 'Hill',
  'Park', 'Lake', 'Church', 'Market', 'Bridge', 'High', 'Crown',
  'Central', 'Union', 'Mill', 'Spring', 'Forest', 'Sunset',
  'Lincoln', 'Washington', 'Jefferson', 'Madison', 'Monroe', 'Franklin',
];
const STREET_SUFFIXES = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Pl', 'Way', 'Rd'];

function generateStreetNames(rng: () => number, count: number): string[] {
  const pool = [...STREET_WORDS];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) { names.push(`${i + 1}th St`); continue; }
    const word = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    names.push(`${word} ${STREET_SUFFIXES[Math.floor(rng() * STREET_SUFFIXES.length)]}`);
  }
  return names;
}

/**
 * Generates a European-style city grid layout with varied street widths and block sizes.
 *
 * Streets vary from narrow alleys to wide boulevards.
 * Blocks vary significantly in size for an organic look.
 * Each block is subdivided into building plots.
 */
export function generateCityLayout(
  gridX: number,
  gridZ: number,
  seed = 42,
): CityLayoutData {
  const rng = createRNG(seed);

  const ROAD_FRACTION = 0.65; // road takes ~65% of street width
  const MIN_BLOCK_SIZE = 90;
  const MAX_BLOCK_SIZE = 100;
  const PLOT_MARGIN = 0.5;
  const MIN_PLOT_WIDTH = 6;
  const MAX_PLOT_WIDTH = 16;

  // Each street gets its own width. Road occupies ROAD_FRACTION of total width.
  // Lane width ~3.5 units → 2 lanes: 8–12, 3 lanes: 12–16
  function randomStreetWidth(): number {
    const roll = rng();
    if (roll < 0.55) return randRange(rng, 8, 12);   // 2-lane street
    return randRange(rng, 12, 16);                    // 3-lane street
  }

  // Street widths: (gridX-1) vertical streets, (gridZ-1) horizontal streets
  // Streets are only between blocks — edges are blocks, not streets.
  const vStreetWidths: number[] = [];
  const hStreetWidths: number[] = [];
  for (let i = 0; i < gridX - 1; i++) vStreetWidths.push(randomStreetWidth());
  for (let j = 0; j < gridZ - 1; j++) hStreetWidths.push(randomStreetWidth());

  // Block sizes — wider variance than before
  const blockWidths: number[] = [];
  const blockDepths: number[] = [];
  for (let i = 0; i < gridX; i++) {
    blockWidths.push(randRange(rng, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE));
  }
  for (let j = 0; j < gridZ; j++) {
    blockDepths.push(randRange(rng, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE));
  }

  // Compute cumulative X positions: block + street + block + street + … + block
  const blockXPositions: number[] = [];
  let cx = 0;
  for (let i = 0; i < gridX; i++) {
    blockXPositions.push(cx);
    cx += blockWidths[i];
    if (i < gridX - 1) cx += vStreetWidths[i];
  }
  const totalWidth = cx;

  const blockZPositions: number[] = [];
  let cz = 0;
  for (let j = 0; j < gridZ; j++) {
    blockZPositions.push(cz);
    cz += blockDepths[j];
    if (j < gridZ - 1) cz += hStreetWidths[j];
  }
  const totalDepth = cz;

  // X positions where vertical streets start (between blocks only)
  const vStreetStarts: number[] = [];
  for (let i = 0; i < gridX - 1; i++) {
    vStreetStarts.push(blockXPositions[i] + blockWidths[i]);
  }

  // Z positions where horizontal streets start (between blocks only)
  const hStreetStarts: number[] = [];
  for (let j = 0; j < gridZ - 1; j++) {
    hStreetStarts.push(blockZPositions[j] + blockDepths[j]);
  }

  const blocks: BlockDef[] = [];
  const streets: StreetSegment[] = [];
  const sidewalks: StreetSegment[] = [];

  // Pick 3-4 random block indices to be parks (avoid edge blocks)
  const totalBlocks = gridX * gridZ;
  const parkCount = Math.min(4, Math.max(3, Math.floor(totalBlocks * 0.05)));
  const parkIndices = new Set<number>();
  while (parkIndices.size < parkCount) {
    const i = Math.floor(rng() * (gridX - 2)) + 1;
    const j = Math.floor(rng() * (gridZ - 2)) + 1;
    parkIndices.add(i * gridZ + j);
  }

  // Generate blocks and their building plots
  let blockIndex = 0;
  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridZ; j++) {
      const bx = blockXPositions[i];
      const bz = blockZPositions[j];
      const bw = blockWidths[i];
      const bd = blockDepths[j];
      const isPark = parkIndices.has(blockIndex);

      const plots = isPark ? [] : subdividePlots(rng, bx, bz, bw, bd, PLOT_MARGIN, MIN_PLOT_WIDTH, MAX_PLOT_WIDTH);
      blocks.push({ x: bx, z: bz, width: bw, depth: bd, plots, isPark });
      blockIndex++;
    }
  }

  // Precompute per-street road and sidewalk widths for corner generation
  const hRoadW: number[] = hStreetWidths.map(sw => sw * ROAD_FRACTION);
  const hSidewalkW: number[] = hStreetWidths.map((sw, j) => (sw - hRoadW[j]) / 2);
  const vRoadW: number[] = vStreetWidths.map(sw => sw * ROAD_FRACTION);
  const vSidewalkW: number[] = vStreetWidths.map((sw, i) => (sw - vRoadW[i]) / 2);

  // Generate horizontal streets (running along X axis) — only between blocks
  for (let j = 0; j < gridZ - 1; j++) {
    const sz = hStreetStarts[j];
    const roadW = hRoadW[j];
    const sidewalkW = hSidewalkW[j];

    // Road spans full width
    streets.push({
      x: 0,
      z: sz + sidewalkW,
      width: totalWidth,
      depth: roadW,
    });

    // Sidewalk segments between vertical streets (skip intersections and corners)
    // First segment: from city left edge to first vertical street
    if (vStreetStarts.length > 0) {
      const endX = vStreetStarts[0];
      if (endX > 0) {
        sidewalks.push({ x: 0, z: sz, width: endX, depth: sidewalkW });
        sidewalks.push({ x: 0, z: sz + sidewalkW + roadW, width: endX, depth: sidewalkW });
      }
    }
    for (let k = 0; k < vStreetStarts.length; k++) {
      const startX = vStreetStarts[k] + vStreetWidths[k];
      const endX = k + 1 < vStreetStarts.length ? vStreetStarts[k + 1] : totalWidth;
      if (endX <= startX) continue;
      sidewalks.push({ x: startX, z: sz, width: endX - startX, depth: sidewalkW });
      sidewalks.push({ x: startX, z: sz + sidewalkW + roadW, width: endX - startX, depth: sidewalkW });
    }
  }

  // Generate vertical streets (running along Z axis) — only between blocks
  for (let i = 0; i < gridX - 1; i++) {
    const sx = vStreetStarts[i];
    const roadW = vRoadW[i];
    const sidewalkW = vSidewalkW[i];

    // Road spans full depth
    streets.push({
      x: sx + sidewalkW,
      z: 0,
      width: roadW,
      depth: totalDepth,
    });

    // Sidewalk segments between horizontal streets (skip intersections and corners)
    // First segment: from city top edge to first horizontal street
    if (hStreetStarts.length > 0) {
      const endZ = hStreetStarts[0];
      if (endZ > 0) {
        sidewalks.push({ x: sx, z: 0, width: sidewalkW, depth: endZ });
        sidewalks.push({ x: sx + sidewalkW + roadW, z: 0, width: sidewalkW, depth: endZ });
      }
    }
    for (let k = 0; k < hStreetStarts.length; k++) {
      const startZ = hStreetStarts[k] + hStreetWidths[k];
      const endZ = k + 1 < hStreetStarts.length ? hStreetStarts[k + 1] : totalDepth;
      if (endZ <= startZ) continue;
      sidewalks.push({ x: sx, z: startZ, width: sidewalkW, depth: endZ - startZ });
      sidewalks.push({ x: sx + sidewalkW + roadW, z: startZ, width: sidewalkW, depth: endZ - startZ });
    }
  }

  // Fill intersection corners at each crossing of vertical street i and horizontal street j
  for (let i = 0; i < gridX - 1; i++) {
    const sx = vStreetStarts[i];
    const vRoad = vRoadW[i];
    const vSide = vSidewalkW[i];

    for (let j = 0; j < gridZ - 1; j++) {
      const sz = hStreetStarts[j];
      const hRoad = hRoadW[j];
      const hSide = hSidewalkW[j];

      if (vSide <= 0 || hSide <= 0) continue;

      // top-left corner
      sidewalks.push({ x: sx,                   z: sz,                   width: vSide, depth: hSide });
      // top-right corner
      sidewalks.push({ x: sx + vSide + vRoad,   z: sz,                   width: vSide, depth: hSide });
      // bottom-left corner
      sidewalks.push({ x: sx,                   z: sz + hSide + hRoad,   width: vSide, depth: hSide });
      // bottom-right corner
      sidewalks.push({ x: sx + vSide + vRoad,   z: sz + hSide + hRoad,   width: vSide, depth: hSide });
    }
  }

  const vStreetNames = generateStreetNames(rng, gridX - 1);
  const hStreetNames = generateStreetNames(rng, gridZ - 1);

  const intersections: IntersectionDef[] = [];
  for (let i = 0; i < gridX - 1; i++) {
    for (let j = 0; j < gridZ - 1; j++) {
      const vSide = vSidewalkW[i];
      const hSide = hSidewalkW[j];
      if (vSide <= 0 || hSide <= 0) continue;
      intersections.push({
        px: vStreetStarts[i] + vSide * 0.25,
        pz: hStreetStarts[j] + hSide * 0.25,
        vIdx: i,
        hIdx: j,
      });
    }
  }

  return { blocks, streets, sidewalks, totalWidth, totalDepth, vStreetNames, hStreetNames, intersections };
}

/**
 * Subdivide a block into building plots using a randomized 2-pass approach:
 * - Randomly split the block into rows along Z
 * - Each row is subdivided into plots along X
 * This produces more organic, varied layouts than the fixed front/back row approach.
 */
function subdividePlots(
  rng: () => number,
  blockX: number,
  blockZ: number,
  blockW: number,
  blockD: number,
  margin: number,
  minW: number,
  maxW: number,
): PlotDef[] {
  const plots: PlotDef[] = [];

  // Decide how many depth rows: 1 row for small blocks, 2-3 for large ones
  const numRows = blockD < 28 ? 1 : randInt(rng, 2, blockD > 42 ? 3 : 2);

  // Split block depth into rows with random proportions.
  // Available depth = blockD minus outer margins (top+bottom) and inter-row gaps.
  const rowDepths: number[] = [];
  const availableD = blockD - 2 * margin - (numRows - 1) * margin;
  if (numRows === 1) {
    rowDepths.push(availableD);
  } else {
    let remaining = availableD;
    for (let r = 0; r < numRows - 1; r++) {
      const rowsLeft = numRows - r;
      const minShare = Math.max(minW + 2 * margin, remaining / rowsLeft * 0.4);
      const maxShare = remaining / rowsLeft * 0.8;
      const share = randRange(rng, minShare, Math.max(minShare + 1, maxShare));
      rowDepths.push(share);
      remaining -= share;
    }
    rowDepths.push(remaining);
  }

  let rowZ = blockZ + margin;
  for (let r = 0; r < numRows; r++) {
    const rd = rowDepths[r];
    const plotDepth = rd - margin * 2;
    if (plotDepth < minW) break;

    // Random min/max plot width per row for variety
    const rowMinW = randRange(rng, minW, minW * 1.3);
    const rowMaxW = randRange(rng, maxW * 0.6, maxW);

    let px = blockX + margin;
    const endX = blockX + blockW - margin;

    while (px + rowMinW <= endX) {
      const remaining = endX - px;
      const w = Math.min(randRange(rng, rowMinW, rowMaxW), remaining);
      if (w < rowMinW) break;

      const plotWidth = w - margin;
      if (plotWidth < 1 || plotDepth < 1) { px += w; continue; }

      const floors = randInt(rng, 2, 8); // 2-8 floors

      plots.push({
        x: px,
        z: rowZ,
        width: plotWidth,
        depth: plotDepth,
        floors,
      });

      px += w;
    }

    rowZ += rd + margin; // rd = row height (excluding outer margins), +margin = gap to next row
  }

  return plots;
}
