import { createRNG, randRange } from '../utils/random';

export interface BlockDef {
  /** Block bounding box in world coords (x, z) */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Building plots inside this block */
  plots: PlotDef[];
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

export interface CityLayoutData {
  blocks: BlockDef[];
  streets: StreetSegment[];
  sidewalks: StreetSegment[];
  totalWidth: number;
  totalDepth: number;
}

/**
 * Generates a European-style city grid layout.
 *
 * The city is a grid of blocks separated by streets.
 * Each block is subdivided into building plots.
 * Streets vary slightly in width for realism.
 */
export function generateCityLayout(
  gridX: number,
  gridZ: number,
  seed = 42,
): CityLayoutData {
  const rng = createRNG(seed);

  const STREET_WIDTH = 8; // meters — road + sidewalks
  const ROAD_WIDTH = 5; // meters — driveable road
  const SIDEWALK_WIDTH = (STREET_WIDTH - ROAD_WIDTH) / 2;
  const MIN_BLOCK_SIZE = 25;
  const MAX_BLOCK_SIZE = 40;
  const PLOT_MARGIN = 0.5; // gap between buildings
  const MIN_PLOT_WIDTH = 6;
  const MAX_PLOT_WIDTH = 14;

  // Generate block sizes
  const blockWidths: number[] = [];
  const blockDepths: number[] = [];
  for (let i = 0; i < gridX; i++) {
    blockWidths.push(randRange(rng, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE));
  }
  for (let j = 0; j < gridZ; j++) {
    blockDepths.push(randRange(rng, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE));
  }

  // Compute cumulative positions
  const blockXPositions: number[] = [];
  let cx = 0;
  for (let i = 0; i < gridX; i++) {
    blockXPositions.push(cx + STREET_WIDTH);
    cx += blockWidths[i] + STREET_WIDTH;
  }
  const totalWidth = cx + STREET_WIDTH;

  const blockZPositions: number[] = [];
  let cz = 0;
  for (let j = 0; j < gridZ; j++) {
    blockZPositions.push(cz + STREET_WIDTH);
    cz += blockDepths[j] + STREET_WIDTH;
  }
  const totalDepth = cz + STREET_WIDTH;

  const verticalStreetStarts: number[] = [0];
  for (let i = 0; i < gridX; i++) {
    verticalStreetStarts.push(blockXPositions[i] + blockWidths[i]);
  }

  const horizontalStreetStarts: number[] = [0];
  for (let j = 0; j < gridZ; j++) {
    horizontalStreetStarts.push(blockZPositions[j] + blockDepths[j]);
  }

  const blocks: BlockDef[] = [];
  const streets: StreetSegment[] = [];
  const sidewalks: StreetSegment[] = [];

  // Generate blocks and their building plots
  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridZ; j++) {
      const bx = blockXPositions[i];
      const bz = blockZPositions[j];
      const bw = blockWidths[i];
      const bd = blockDepths[j];

      const plots = subdividePlots(rng, bx, bz, bw, bd, PLOT_MARGIN, MIN_PLOT_WIDTH, MAX_PLOT_WIDTH);
      blocks.push({ x: bx, z: bz, width: bw, depth: bd, plots });
    }
  }

  // Generate horizontal streets (running along X axis)
  for (let j = 0; j <= gridZ; j++) {
    const sz = j === 0 ? 0 : blockZPositions[j - 1] + blockDepths[j - 1];
    // Road
    streets.push({
      x: 0,
      z: sz + SIDEWALK_WIDTH,
      width: totalWidth,
      depth: ROAD_WIDTH,
    });
    // Top sidewalk segments
    for (let k = 0; k < verticalStreetStarts.length - 1; k++) {
      const startX = k === 0 ? 0 : verticalStreetStarts[k] + SIDEWALK_WIDTH + ROAD_WIDTH;
      const endX = verticalStreetStarts[k + 1] + SIDEWALK_WIDTH;
      sidewalks.push({
        x: startX,
        z: sz,
        width: endX - startX,
        depth: SIDEWALK_WIDTH,
      });
    }
    // Bottom sidewalk segments
    for (let k = 0; k < verticalStreetStarts.length - 1; k++) {
      const startX = k === 0 ? 0 : verticalStreetStarts[k] + SIDEWALK_WIDTH + ROAD_WIDTH;
      const endX = verticalStreetStarts[k + 1] + SIDEWALK_WIDTH;
      sidewalks.push({
        x: startX,
        z: sz + SIDEWALK_WIDTH + ROAD_WIDTH,
        width: endX - startX,
        depth: SIDEWALK_WIDTH,
      });
    }
  }

  // Generate vertical streets (running along Z axis)
  for (let i = 0; i <= gridX; i++) {
    const sx = i === 0 ? 0 : blockXPositions[i - 1] + blockWidths[i - 1];
    streets.push({
      x: sx + SIDEWALK_WIDTH,
      z: 0,
      width: ROAD_WIDTH,
      depth: totalDepth,
    });
    // Left sidewalk segments
    for (let k = 0; k < horizontalStreetStarts.length - 1; k++) {
      const startZ = k === 0 ? 0 : horizontalStreetStarts[k] + SIDEWALK_WIDTH + ROAD_WIDTH;
      const endZ = horizontalStreetStarts[k + 1] + SIDEWALK_WIDTH;
      sidewalks.push({
        x: sx,
        z: startZ,
        width: SIDEWALK_WIDTH,
        depth: endZ - startZ,
      });
    }
    // Right sidewalk segments
    for (let k = 0; k < horizontalStreetStarts.length - 1; k++) {
      const startZ = k === 0 ? 0 : horizontalStreetStarts[k] + SIDEWALK_WIDTH + ROAD_WIDTH;
      const endZ = horizontalStreetStarts[k + 1] + SIDEWALK_WIDTH;
      sidewalks.push({
        x: sx + SIDEWALK_WIDTH + ROAD_WIDTH,
        z: startZ,
        width: SIDEWALK_WIDTH,
        depth: endZ - startZ,
      });
    }
  }

  return { blocks, streets, sidewalks, totalWidth, totalDepth };
}

/**
 * Subdivide a block into building plots along the X axis.
 * Buildings fill the block depth, varied widths.
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

  // European style: buildings form a perimeter around the block
  // For simplicity we place buildings in two rows (front and back) along Z
  const rowDepth = Math.min(blockD * 0.4, 12);

  for (const rowZ of [blockZ + margin, blockZ + blockD - rowDepth - margin]) {
    let px = blockX + margin;
    const endX = blockX + blockW - margin;

    while (px + minW <= endX) {
      const remaining = endX - px;
      const w = Math.min(randRange(rng, minW, maxW), remaining);
      if (w < minW) break;

      const floors = Math.floor(randRange(rng, 2, 7)); // 2-6 floors

      plots.push({
        x: px,
        z: rowZ,
        width: w - margin,
        depth: rowDepth - margin,
        floors,
      });

      px += w;
    }
  }

  // Side buildings connecting front and back rows
  const innerZ = blockZ + margin + rowDepth;
  const innerDepth = blockD - 2 * (rowDepth + margin);
  if (innerDepth > 4) {
    for (const sideX of [blockX + margin, blockX + blockW - margin - randRange(rng, minW, Math.min(maxW, 10))]) {
      const w = randRange(rng, minW, Math.min(maxW, 10));
      if (sideX + w <= blockX + blockW) {
        plots.push({
          x: sideX,
          z: innerZ,
          width: w - margin,
          depth: innerDepth,
          floors: Math.floor(randRange(rng, 2, 5)),
        });
      }
    }
  }

  return plots;
}
