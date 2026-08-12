import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Droplets, RefreshCw, Ruler, Sparkles } from "lucide-react";

type TileId = string;
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type RoomLayout = {
  name: string;
  seed: string;
  floorRects: Rect[];
  waterRects: Rect[];
  bridgeCells: Point[];
  stairsUp: [number, number];
  stairsDown: [number, number];
};

const TILE_ROOT = "/images/tileset";
const COLS = 24;
const ROWS = 17;
const floorTiles = ["B2", "C2", "D2", "E2", "B3", "C3", "D3", "E3", "B4", "C4", "D4", "E4"];
const topWalls = ["A1", "B1", "C1", "D1", "E1", "F1"];
const bottomCaps = ["A5", "B5", "C5", "D5", "E5", "F5"];
const voidTile = "H2";

const randomInt = (random: () => number, min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

function createSeed() {
  return `R-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0")}`;
}

function createRandom(seed: string) {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) value = (value * 31 + seed.charCodeAt(index)) | 0;
  return () => {
    value = Math.imul(1664525, value) + 1013904223;
    return (value >>> 0) / 0x100000000;
  };
}

const lineCells = (start: Point, end: Point) => {
  const cells: Point[] = [];
  if (start.y === end.y) {
    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x += 1) cells.push({ x, y: start.y });
  } else if (start.x === end.x) {
    for (let y = Math.min(start.y, end.y); y <= Math.max(start.y, end.y); y += 1) cells.push({ x: start.x, y });
  }
  return cells;
};

const layoutFrom = (
  seed: string,
  name: string,
  floorRects: Rect[],
  waterRects: Rect[],
  bridgeCells: Point[],
  stairsUp: [number, number],
  stairsDown: [number, number],
): RoomLayout => {
  const normalized = normalizeFloorRects(floorRects);
  const withConnections = ensureConnectedRects(normalized);
  const finalRects = normalizeFloorRects(withConnections);

  // Prevent water from blocking single-tile hallways: remove any water rect
  // that would place water on a cell that belongs to a 1-tile-wide corridor.
  const corridorCells = new Set<string>();
  finalRects.forEach((r) => {
    if (r.w === 1 || r.h === 1) {
      for (let y = r.y; y < r.y + r.h; y += 1) {
        for (let x = r.x; x < r.x + r.w; x += 1) corridorCells.add(`${x},${y}`);
      }
    }
  });

  const filteredWater = waterRects.filter((wr) => {
    for (let y = wr.y; y < wr.y + wr.h; y += 1) {
      for (let x = wr.x; x < wr.x + wr.w; x += 1) {
        if (corridorCells.has(`${x},${y}`)) return false;
      }
    }
    return true;
  });

  return { name, seed, floorRects: finalRects, waterRects: filteredWater, bridgeCells, stairsUp, stairsDown };
};
// Ensure generated floor regions are connected by inserting narrow corridors
function rectsToCellSet(rects: Rect[]) {
  const cells = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  rects.forEach((r) => {
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) cells.add(key(x, y));
  });
  return cells;
}

function cellSetToRects(cells: Set<string>) {
  const keyToXY = (k: string) => k.split(",").map((n) => Number(n));
  const rects: Rect[] = [];
  const visited = new Set<string>();
  for (const k of cells) {
    if (visited.has(k)) continue;
    const [sx, sy] = keyToXY(k);
    // grow a horizontal run
    let ex = sx;
    while (cells.has(`${ex + 1},${sy}`)) ex += 1;
    // grow downward as long as full runs exist
    let height = 1;
    let keep = true;
    while (keep) {
      for (let x = sx; x <= ex; x += 1) if (!cells.has(`${x},${sy + height}`)) { keep = false; break; }
      if (keep) height += 1;
    }
    for (let y = sy; y < sy + height; y += 1) for (let x = sx; x <= ex; x += 1) visited.add(`${x},${y}`);
    rects.push({ x: sx, y: sy, w: ex - sx + 1, h: height });
  }
  return rects;
}

function ensureConnectedRects(rects: Rect[]) {
  const cells = rectsToCellSet(rects);
  if (cells.size === 0) return rects;
  const key = (x: number, y: number) => `${x},${y}`;
  const neighbors = (kx: string) => {
    const [x, y] = kx.split(",").map((n) => Number(n));
    return [`${x-1},${y}`, `${x+1},${y}`, `${x},${y-1}`, `${x},${y+1}`].filter((n) => cells.has(n));
  };
  const components: string[][] = [];
  const seen = new Set<string>();
  for (const k of cells) {
    if (seen.has(k)) continue;
    const comp: string[] = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of neighbors(cur)) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
    components.push(comp);
  }
  if (components.length <= 1) return rects;

  // connect each additional component to the first component using an L-shaped corridor
  const corridors: Rect[] = [];
  const compCentroid = (comp: string[]) => {
    let sx = 0, sy = 0;
    comp.forEach((c) => { const [x, y] = c.split(",").map((n) => Number(n)); sx += x; sy += y; });
    return { x: Math.round(sx / comp.length), y: Math.round(sy / comp.length) };
  };
  const main = compCentroid(components[0]);
  for (let i = 1; i < components.length; i += 1) {
    const other = compCentroid(components[i]);
    // horizontal then vertical corridor
    const hx1 = Math.min(main.x, other.x);
    const hx2 = Math.max(main.x, other.x);
    corridors.push({ x: hx1, y: main.y, w: hx2 - hx1 + 1, h: 1 });
    const vy1 = Math.min(main.y, other.y);
    const vy2 = Math.max(main.y, other.y);
    corridors.push({ x: other.x, y: vy1, w: 1, h: vy2 - vy1 + 1 });
  }
  return [...rects, ...corridors];
}

/**
 * Keep every generated footprint readable at the native tile scale. A void
 * cell that sits between floor on opposite sides is a one-tile notch or gap;
 * filling it prevents accidental hairline corridors while preserving larger
 * courtyards, openings, and abstract negative space.
 */
function normalizeFloorRects(rects: Rect[]) {
  const cells = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  rects.forEach((rect) => {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) cells.add(key(x, y));
    }
  });

  const additions: string[] = [];
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (cells.has(key(x, y))) continue;
      const north = cells.has(key(x, y - 1));
      const south = cells.has(key(x, y + 1));
      const west = cells.has(key(x - 1, y));
      const east = cells.has(key(x + 1, y));
      if ((north && south) || (west && east)) additions.push(key(x, y));
    }
  }
  additions.forEach((cell) => cells.add(cell));

  const merged: Rect[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    let x = 0;
    while (x < COLS) {
      if (!cells.has(key(x, y))) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < COLS && cells.has(key(x, y))) x += 1;
      const width = x - start;
      const previous = merged[merged.length - 1];
      if (previous && previous.x === start && previous.w === width && previous.y + previous.h === y) {
        previous.h += 1;
      } else {
        merged.push({ x: start, y, w: width, h: 1 });
      }
    }
  }
  return merged;
}

function createCourtyardLayout(seed: string, random: () => number) {
  const courtyard: Rect = {
    x: randomInt(random, 2, 3),
    y: randomInt(random, 2, 3),
    w: randomInt(random, 17, 19),
    h: randomInt(random, 11, 13),
  };
  const pool: Rect = {
    x: courtyard.x + 1,
    y: courtyard.y + 1,
    w: courtyard.w - 2,
    h: courtyard.h - 2,
  };
  const entranceY = courtyard.y + randomInt(random, 2, courtyard.h - 3);
  const entrance: Rect = {
    x: courtyard.x + courtyard.w - 1,
    y: entranceY,
    w: COLS - (courtyard.x + courtyard.w - 1) - 1,
    h: 2,
  };

  return layoutFrom(
    seed,
    random() < 0.34 ? "Sunken cistern courtyard" : "Open courtyard",
    [courtyard, entrance],
    optionalWater(random, [pool], 0.30),
    [],
    [courtyard.x, courtyard.y + 1],
    [courtyard.x + courtyard.w - 1, entranceY],
  );
}

function createSewerLayout(seed: string, random: () => number) {
  const upperX = randomInt(random, 3, 5);
  const firstTurnY = randomInt(random, 6, 8);
  const secondX = randomInt(random, 12, 14);
  const poolW = randomInt(random, 3, 5);
  const pool: Rect = {
    x: 20 - poolW,
    y: 11,
    w: poolW,
    h: randomInt(random, 2, 3),
  };
  const verticalStart: Rect = { x: upperX, y: 2, w: 3, h: firstTurnY + 2 - 2 };
  const firstTurn: Rect = { x: upperX, y: firstTurnY, w: secondX - upperX + 3, h: 3 };
  const secondTurn: Rect = { x: secondX, y: firstTurnY, w: 3, h: 14 - firstTurnY };
  const spillway: Rect = { x: secondX, y: 11, w: 21 - secondX, h: 3 };

  return layoutFrom(
    seed,
    random() < 0.36 ? "Sewer spillway" : "Dry switchback sewer",
    [verticalStart, firstTurn, secondTurn, spillway],
    optionalWater(random, [pool], 0.30),
    [],
    [upperX + 1, 3],
    [secondX + 1, firstTurnY + 1],
  );
}

function createFloodedWingLayout(seed: string, random: () => number) {
  const leftRoom: Rect = { x: 2, y: 2, w: randomInt(random, 9, 11), h: randomInt(random, 10, 12) };
  const rightRoom: Rect = {
    x: randomInt(random, 14, 15),
    y: randomInt(random, 3, 5),
    w: randomInt(random, 7, 8),
    h: randomInt(random, 8, 10),
  };
  const hallY = randomInt(random, 6, 8);
  const hall: Rect = { x: leftRoom.x + leftRoom.w - 1, y: hallY, w: rightRoom.x - leftRoom.x - leftRoom.w + 2, h: 3 };
  const pool: Rect = { x: leftRoom.x + 1, y: leftRoom.y + 1, w: leftRoom.w - 2, h: leftRoom.h - 2 };

  return layoutFrom(
    seed,
    random() < 0.38 ? "Flooded west wing" : "West wing chambers",
    [leftRoom, hall, rightRoom],
    optionalWater(random, [pool], 0.30),
    lineCells({ x: pool.x, y: hallY + 1 }, { x: pool.x + pool.w - 1, y: hallY + 1 }),
    [leftRoom.x, leftRoom.y + leftRoom.h - 2],
    [rightRoom.x + rightRoom.w - 2, rightRoom.y + 1],
  );
}

function createBridgeBasinLayout(seed: string, random: () => number) {
  const room: Rect = { x: 2, y: 2, w: 20, h: 12 };
  const verticalBasin = random() > 0.5;
  const pool: Rect = verticalBasin
    ? { x: 9, y: room.y + 1, w: randomInt(random, 5, 7), h: room.h - 2 }
    : { x: room.x + 2, y: 5, w: randomInt(random, 11, 14), h: randomInt(random, 5, 7) };
  const bridgeCells = verticalBasin
    ? lineCells({ x: pool.x + Math.floor(pool.w / 2), y: pool.y }, { x: pool.x + Math.floor(pool.w / 2), y: pool.y + pool.h - 1 })
    : lineCells({ x: pool.x, y: pool.y + Math.floor(pool.h / 2) }, { x: pool.x + pool.w - 1, y: pool.y + Math.floor(pool.h / 2) });

  return layoutFrom(
    seed,
    random() < 0.38
      ? verticalBasin ? "North-south bridge basin" : "Wide bridge basin"
      : verticalBasin ? "North-south bridge hall" : "Wide dry bridge hall",
    [room],
    optionalWater(random, [pool], 0.30),
    bridgeCells,
    [room.x + 1, room.y + 1],
    [room.x + room.w - 2, room.y + room.h - 2],
  );
}

function createCrossroadsLayout(seed: string, random: () => number) {
  const verticalX = randomInt(random, 9, 11);
  const horizontalY = randomInt(random, 6, 8);
  const floodedLeft = random() > 0.5;
  const vertical: Rect = { x: verticalX, y: 2, w: 5, h: 13 };
  const horizontal: Rect = { x: 3, y: horizontalY, w: 18, h: 5 };
  const pool: Rect = floodedLeft
    ? { x: 4, y: horizontalY + 1, w: 5, h: 3 }
    : { x: 16, y: horizontalY + 1, w: 5, h: 3 };

  return layoutFrom(
    seed,
    random() < 0.34
      ? floodedLeft ? "Flooded west crossroads" : "Flooded east crossroads"
      : floodedLeft ? "West crossroads" : "East crossroads",
    [vertical, horizontal],
    optionalWater(random, [pool], 0.30),
    [],
    [verticalX + 2, 3],
    floodedLeft ? [19, horizontalY + 2] : [4, horizontalY + 2],
  );
}

/**
 * Water is a special feature, not a default room treatment. Layouts can
 * suggest one or more basin locations, but the generator caps the requested
 * probability so most generated rooms stay dry even when their footprint has
 * a natural basin-shaped area.
 */
const optionalWater = (random: () => number, candidates: Rect[], chance = 0.50) => {
  if (random() > chance) return [];
  return [candidates[randomInt(random, 0, candidates.length - 1)]];
};

function createLShapeLayout(seed: string, random: () => number) {
  const verticalX = randomInt(random, 3, 5);
  const baseY = randomInt(random, 10, 11);
  const vertical: Rect = { x: verticalX, y: 2, w: randomInt(random, 5, 6), h: 13 };
  const base: Rect = { x: verticalX, y: baseY, w: randomInt(random, 15, 18), h: 4 };
  const pool: Rect = { x: base.x + base.w - 6, y: baseY + 1, w: 4, h: 2 };

  return layoutFrom(
    seed,
    "L-shaped reservoir",
    [vertical, base],
    optionalWater(random, [pool], 0.30),
    [],
    [vertical.x + 1, 3],
    [base.x + base.w - 2, base.y + 1],
  );
}

function createSShapeLayout(seed: string, random: () => number) {
  const top: Rect = { x: 3, y: 2, w: randomInt(random, 15, 18), h: 4 };
  const spine: Rect = { x: randomInt(random, 9, 11), y: 4, w: 5, h: 9 };
  const bottom: Rect = { x: randomInt(random, 4, 6), y: 11, w: 17, h: 4 };
  const topPool: Rect = { x: top.x + 2, y: top.y + 1, w: 5, h: 2 };
  const bottomPool: Rect = { x: bottom.x + 8, y: bottom.y + 1, w: 5, h: 2 };
  const waterRects = optionalWater(random, [topPool, bottomPool], 0.30);

  return layoutFrom(
    seed,
    "S-curve aqueduct",
    [top, spine, bottom],
    waterRects,
    [],
    [top.x + top.w - 3, top.y + 1],
    [bottom.x + bottom.w - 3, bottom.y + 1],
  );
}

function createUShapeLayout(seed: string, random: () => number) {
  const left: Rect = { x: 3, y: 2, w: 5, h: 13 };
  const right: Rect = { x: 16, y: 2, w: 5, h: 13 };
  const base: Rect = { x: 3, y: 11, w: 18, h: 4 };
  const courtyardBasin: Rect = { x: 8, y: 6, w: 8, h: 5 };

  return layoutFrom(
    seed,
    random() > 0.45 ? "U-shaped cloister basin" : "U-shaped dry cloister",
    [left, right, base],
    optionalWater(random, [courtyardBasin], 0.30),
    [],
    [left.x + 1, left.y + 1],
    [right.x + 2, right.y + 1],
  );
}

function createTShapeLayout(seed: string, random: () => number) {
  const crown: Rect = { x: 3, y: 2, w: 18, h: 5 };
  const stem: Rect = { x: randomInt(random, 9, 10), y: 6, w: 5, h: 9 };
  const pools = [
    { x: crown.x + 2, y: crown.y + 1, w: 5, h: 2 },
    { x: crown.x + crown.w - 7, y: crown.y + 2, w: 5, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "T-shaped tide hall" : "T-shaped stone gallery",
    [crown, stem],
    optionalWater(random, pools, 0.3),
    [],
    [stem.x + 2, stem.y + 2],
    [stem.x + 2, stem.y + stem.h - 2],
  );
}

function createHShapeLayout(seed: string, random: () => number) {
  const left: Rect = { x: 3, y: 2, w: 5, h: 13 };
  const right: Rect = { x: 16, y: 2, w: 5, h: 13 };
  const crossbar: Rect = { x: 3, y: randomInt(random, 6, 8), w: 18, h: 5 };
  const pool: Rect = random() > 0.5
    ? { x: left.x + 1, y: 5, w: 3, h: 3 }
    : { x: right.x + 1, y: 5, w: 3, h: 3 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "H-shaped crossing" : "Twin-column nave",
    [left, right, crossbar],
    optionalWater(random, [pool], 0.3),
    [],
    [left.x + 1, 3],
    [right.x + 2, 12],
  );
}

function createCShapeLayout(seed: string, random: () => number) {
  const spine: Rect = { x: 3, y: 2, w: 5, h: 13 };
  const top: Rect = { x: 3, y: 2, w: 18, h: 4 };
  const bottom: Rect = { x: 3, y: 11, w: 18, h: 4 };
  const topPool: Rect = { x: 10, y: 3, w: 6, h: 2 };
  const bottomPool: Rect = { x: 10, y: 12, w: 6, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "C-shaped open gallery" : "C-shaped dry arcade",
    [spine, top, bottom],
    optionalWater(random, [topPool, bottomPool], 0.3),
    [],
    [spine.x + 1, 3],
    [bottom.x + bottom.w - 3, bottom.y + 1],
  );
}

function createRingLayout(seed: string, random: () => number) {
  const top: Rect = { x: 3, y: 2, w: 18, h: 4 };
  const left: Rect = { x: 3, y: 2, w: 4, h: 13 };
  const right: Rect = { x: 17, y: 2, w: 4, h: 13 };
  const bottom: Rect = { x: 3, y: 11, w: 18, h: 4 };
  const innerBasin: Rect = { x: 7, y: 6, w: 10, h: 5 };

  return layoutFrom(
    seed,
    random() > 0.45 ? "Four-sided basin ring" : "Dry ring sanctuary",
    [top, left, right, bottom],
    optionalWater(random, [innerBasin], 0.30),
    [],
    [top.x + 2, top.y + 1],
    [bottom.x + bottom.w - 3, bottom.y + 1],
  );
}

function createSwitchbackLayout(seed: string, random: () => number) {
  const upper: Rect = { x: 3, y: 2, w: 13, h: 4 };
  const upperTurn: Rect = { x: 11, y: 4, w: 5, h: 5 };
  const lowerTurn: Rect = { x: 7, y: 8, w: 5, h: 5 };
  const lower: Rect = { x: 7, y: 11, w: 14, h: 4 };
  const pool: Rect = random() > 0.5
    ? { x: 4, y: 3, w: 5, h: 2 }
    : { x: 15, y: 12, w: 5, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Switchback terrace" : "Zigzag spillway",
    [upper, upperTurn, lowerTurn, lower],
    optionalWater(random, [pool], 0.3),
    [],
    [upper.x + upper.w - 3, upper.y + 1],
    [lower.x + 2, lower.y + 1],
  );
}

function createTwinChambersLayout(seed: string, random: () => number) {
  const left: Rect = { x: 2, y: 3, w: 9, h: 10 };
  const right: Rect = { x: 13, y: 2, w: 9, h: 11 };
  const connector: Rect = { x: 9, y: 7, w: 6, h: 3 };
  const leftPool: Rect = { x: 4, y: 5, w: 4, h: 3 };
  const rightPool: Rect = { x: 16, y: 4, w: 4, h: 3 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Twin chambers with a sluice" : "Paired vaulted rooms",
    [left, right, connector],
    random() > 0.72 ? [random() > 0.5 ? leftPool : rightPool] : [],
    [],
    [left.x + 2, left.y + 1],
    [right.x + right.w - 3, right.y + right.h - 2],
  );
}

function createPlusLayout(seed: string, random: () => number) {
  const vertical: Rect = { x: randomInt(random, 9, 10), y: 2, w: 5, h: 13 };
  const horizontal: Rect = { x: 3, y: randomInt(random, 6, 8), w: 18, h: 5 };
  const pools = [
    { x: 4, y: horizontal.y + 1, w: 4, h: 3 },
    { x: 16, y: horizontal.y + 1, w: 4, h: 3 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Four-way star crossing" : "Plus-shaped waterway",
    [vertical, horizontal],
    optionalWater(random, pools, 0.36),
    [],
    [vertical.x + 2, vertical.y + 1],
    [vertical.x + 2, vertical.y + vertical.h - 2],
  );
}

function createYShapeLayout(seed: string, random: () => number) {
  const leftFork: Rect = { x: 3, y: 2, w: 5, h: 8 };
  const rightFork: Rect = { x: 16, y: 2, w: 5, h: 8 };
  const crossbar: Rect = { x: 7, y: 6, w: 10, h: 4 };
  const stem: Rect = { x: 10, y: 8, w: 5, h: 7 };
  const pools = [
    { x: leftFork.x + 1, y: leftFork.y + 2, w: 3, h: 4 },
    { x: rightFork.x + 1, y: rightFork.y + 2, w: 3, h: 4 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Y-shaped forked gallery" : "Three-way split chamber",
    [leftFork, rightFork, crossbar, stem],
    optionalWater(random, pools, 0.34),
    [],
    [stem.x + 2, stem.y + stem.h - 2],
    [leftFork.x + 2, leftFork.y + 1],
  );
}

function createEShapeLayout(seed: string, random: () => number) {
  const spine: Rect = { x: 3, y: 2, w: 4, h: 13 };
  const topArm: Rect = { x: 3, y: 2, w: 17, h: 3 };
  const middleArm: Rect = { x: 3, y: 7, w: randomInt(random, 12, 16), h: 3 };
  const bottomArm: Rect = { x: 3, y: 12, w: 17, h: 3 };
  const pools = [
    { x: 8, y: 3, w: 5, h: 2 },
    { x: 8, y: 8, w: 5, h: 2 },
    { x: 8, y: 13, w: 5, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "E-shaped branching hall" : "Three-arm colonnade",
    [spine, topArm, middleArm, bottomArm],
    optionalWater(random, pools, 0.34),
    [],
    [spine.x + 1, spine.y + 1],
    [bottomArm.x + bottomArm.w - 2, bottomArm.y + 1],
  );
}

function createWShapeLayout(seed: string, random: () => number) {
  const legs = [3, 8, 13, 18].map((x) => ({ x, y: 2, w: 3, h: 13 }));
  const foot: Rect = { x: 3, y: 11, w: 18, h: 4 };
  const pools = [
    { x: 5, y: 12, w: 4, h: 2 },
    { x: 14, y: 12, w: 4, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "W-shaped wellworks" : "Four-column zigzag",
    [...legs, foot],
    optionalWater(random, pools, 0.28),
    [],
    [legs[0].x + 1, 3],
    [legs[3].x + 1, 12],
  );
}

function createDiamondLayout(seed: string, random: () => number) {
  const crown: Rect = { x: 9, y: 2, w: 6, h: 3 };
  const shoulders: Rect = { x: 6, y: 5, w: 12, h: 3 };
  const belly: Rect = { x: 4, y: 8, w: 16, h: 3 };
  const point: Rect = { x: 7, y: 11, w: 10, h: 4 };
  const pool: Rect = { x: 9, y: 8, w: 6, h: 3 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Stepped diamond atrium" : "Faceted reservoir",
    [crown, shoulders, belly, point],
    optionalWater(random, [pool], 0.34),
    [],
    [crown.x + 2, crown.y + 1],
    [point.x + point.w - 3, point.y + 1],
  );
}

function createKShapeLayout(seed: string, random: () => number) {
  const spine: Rect = { x: 3, y: 2, w: 4, h: 13 };
  const upper: Rect[] = [
    { x: 6, y: 2, w: 6, h: 3 },
    { x: 9, y: 5, w: 6, h: 3 },
    { x: 12, y: 8, w: 6, h: 3 },
  ];
  const lower: Rect[] = [
    { x: 12, y: 8, w: 6, h: 3 },
    { x: 9, y: 10, w: 6, h: 3 },
    { x: 6, y: 12, w: 6, h: 3 },
  ];
  const pool: Rect = { x: 14, y: 9, w: 3, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "K-shaped split vault" : "Forked diagonal nave",
    [spine, ...upper, ...lower],
    optionalWater(random, [pool], 0.3),
    [],
    [spine.x + 1, 3],
    [lower[2].x + 2, lower[2].y + 1],
  );
}

function createStarLayout(seed: string, random: () => number) {
  const center: Rect = { x: 9, y: 6, w: 6, h: 5 };
  const north: Rect = { x: 10, y: 2, w: 4, h: 7 };
  const south: Rect = { x: 10, y: 8, w: 4, h: 7 };
  const west: Rect = { x: 3, y: 7, w: 9, h: 3 };
  const east: Rect = { x: 12, y: 7, w: 9, h: 3 };
  const pools = [
    { x: 4, y: 7, w: 4, h: 2 },
    { x: 16, y: 7, w: 4, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Five-point star chamber" : "Radial cistern",
    [center, north, south, west, east],
    optionalWater(random, pools, 0.34),
    [],
    [north.x + 1, north.y + 1],
    [south.x + 2, south.y + south.h - 2],
  );
}

function createZShapeLayout(seed: string, random: () => number) {
  const top: Rect = { x: 3, y: 2, w: 18, h: 3 };
  const upperTurn: Rect = { x: 12, y: 4, w: 5, h: 3 };
  const middle: Rect = { x: 8, y: 7, w: 7, h: 3 };
  const lowerTurn: Rect = { x: 4, y: 9, w: 5, h: 3 };
  const bottom: Rect = { x: 3, y: 12, w: 18, h: 3 };
  const pool: Rect = { x: 16, y: 3, w: 4, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Z-shaped switch channel" : "Diagonal lightning hall",
    [top, upperTurn, middle, lowerTurn, bottom],
    optionalWater(random, [pool], 0.3),
    [],
    [top.x + 2, top.y + 1],
    [bottom.x + bottom.w - 3, bottom.y + 1],
  );
}

function createSpiralLayout(seed: string, random: () => number) {
  const outerTop: Rect = { x: 3, y: 2, w: 18, h: 3 };
  const outerRight: Rect = { x: 18, y: 2, w: 3, h: 13 };
  const outerBottom: Rect = { x: 6, y: 12, w: 15, h: 3 };
  const innerLeft: Rect = { x: 6, y: 8, w: 3, h: 7 };
  const innerMiddle: Rect = { x: 6, y: 8, w: 12, h: 3 };
  const innerRight: Rect = { x: 15, y: 5, w: 3, h: 6 };
  const innerTop: Rect = { x: 9, y: 5, w: 9, h: 3 };
  const pool: Rect = { x: 10, y: 6, w: 4, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Inward spiral cistern" : "Coiled aqueduct",
    [outerTop, outerRight, outerBottom, innerLeft, innerMiddle, innerRight, innerTop],
    optionalWater(random, [pool], 0.3),
    [],
    [outerTop.x + 2, outerTop.y + 1],
    [outerBottom.x + outerBottom.w - 3, outerBottom.y + 1],
  );
}

function createCombLayout(seed: string, random: () => number) {
  const spine: Rect = { x: 3, y: 2, w: 4, h: 13 };
  const topTooth: Rect = { x: 3, y: 2, w: 17, h: 3 };
  const middleTooth: Rect = { x: 3, y: 7, w: randomInt(random, 12, 16), h: 3 };
  const bottomTooth: Rect = { x: 3, y: 12, w: 17, h: 3 };
  const pools = [
    { x: 8, y: 3, w: 4, h: 2 },
    { x: 8, y: 8, w: 4, h: 2 },
    { x: 8, y: 13, w: 4, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Comb-shaped sluice" : "Toothed archive hall",
    [spine, topTooth, middleTooth, bottomTooth],
    optionalWater(random, pools, 0.3),
    [],
    [spine.x + 1, spine.y + 1],
    [bottomTooth.x + bottomTooth.w - 2, bottomTooth.y + 1],
  );
}

function createStaggeredChambersLayout(seed: string, random: () => number) {
  const upper: Rect = { x: 2, y: 2, w: 10, h: 6 };
  const middle: Rect = { x: 7, y: 5, w: 10, h: 6 };
  const lower: Rect = { x: 12, y: 8, w: 10, h: 6 };
  const upperPool: Rect = { x: 5, y: 4, w: 4, h: 2 };
  const lowerPool: Rect = { x: 15, y: 10, w: 4, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Staggered triple chambers" : "Offset room cascade",
    [upper, middle, lower],
    random() > 0.72 ? [random() > 0.5 ? upperPool : lowerPool] : [],
    [],
    [upper.x + 2, upper.y + 1],
    [lower.x + lower.w - 3, lower.y + lower.h - 2],
  );
}

function createSubroomsLayout(seed: string, random: () => number) {
  const leftRoom: Rect = { x: 2, y: 3, w: 7, h: 7 };
  const centralRoom: Rect = { x: 8, y: 5, w: 8, h: 7 };
  const rightRoom: Rect = { x: 15, y: 2, w: 7, h: 7 };
  const lowerRoom: Rect = { x: 9, y: 11, w: 6, h: 4 };
  const leftConnector: Rect = { x: 7, y: 6, w: 4, h: 3 };
  const rightConnector: Rect = { x: 14, y: 5, w: 4, h: 3 };
  const lowerConnector: Rect = { x: 10, y: 9, w: 4, h: 4 };
  const pools = [
    { x: leftRoom.x + 2, y: leftRoom.y + 2, w: 3, h: 3 },
    { x: rightRoom.x + 2, y: rightRoom.y + 2, w: 3, h: 3 },
  ];

  return layoutFrom(
    seed,
    random() < 0.5 ? "Four-room subchamber cluster" : "Nested rooms with connectors",
    [leftRoom, centralRoom, rightRoom, lowerRoom, leftConnector, rightConnector, lowerConnector],
    optionalWater(random, pools, 0.3),
    [],
    [leftRoom.x + 2, leftRoom.y + 1],
    [lowerRoom.x + lowerRoom.w - 2, lowerRoom.y + 1],
  );
}

function createRoomClusterLayout(seed: string, random: () => number) {
  const northWest: Rect = { x: 2, y: 2, w: 8, h: 6 };
  const northEast: Rect = { x: 14, y: 2, w: 8, h: 6 };
  const southWest: Rect = { x: 3, y: 9, w: 8, h: 6 };
  const southEast: Rect = { x: 13, y: 9, w: 8, h: 6 };
  const northHall: Rect = { x: 8, y: 4, w: 8, h: 3 };
  const southHall: Rect = { x: 9, y: 10, w: 6, h: 3 };
  const centralStair: Rect = { x: 10, y: 6, w: 4, h: 6 };
  const pool: Rect = { x: 5, y: 11, w: 4, h: 2 };

  return layoutFrom(
    seed,
    random() < 0.5 ? "Four-room cross cluster" : "Separated chamber court",
    [northWest, northEast, southWest, southEast, northHall, southHall, centralStair],
    optionalWater(random, [pool], 0.30),
    [],
    [northWest.x + 2, northWest.y + 1],
    [southEast.x + southEast.w - 3, southEast.y + southEast.h - 2],
  );
}

function createTinyRoomLayout(seed: string, random: () => number) {
  const room: Rect = { x: 8, y: 6, w: 8, h: 5 };
  const pool: Rect = { x: 9, y: 7, w: 3, h: 2 };

  return layoutFrom(
    seed,
    random() > 0.5 ? "Intimate stone cell" : "Cramped vault",
    [room],
    optionalWater(random, [pool], 0.30),
    [],
    [room.x + 1, room.y + 1],
    [room.x + room.w - 2, room.y + room.h - 2],
  );
}

function createMassiveHallLayout(seed: string, random: () => number) {
  const hall: Rect = { x: 2, y: 2, w: 20, h: 13 };
  const pools = [
    { x: 6, y: 5, w: 6, h: 4 },
    { x: 16, y: 8, w: 5, h: 3 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Grand cathedral hall" : "Vast echoing chamber",
    [hall],
    optionalWater(random, pools, 0.30),
    [],
    [hall.x + 2, hall.y + 1],
    [hall.x + hall.w - 3, hall.y + hall.h - 2],
  );
}

function createHexagonalMazeLayout(seed: string, random: () => number) {
  const center: Rect = { x: 9, y: 6, w: 6, h: 5 };
  const north: Rect = { x: 9, y: 2, w: 6, h: 3 };
  const south: Rect = { x: 9, y: 11, w: 6, h: 4 };
  const northwest: Rect = { x: 4, y: 4, w: 4, h: 3 };
  const northeast: Rect = { x: 16, y: 4, w: 4, h: 3 };
  const southwest: Rect = { x: 3, y: 10, w: 5, h: 4 };
  const southeast: Rect = { x: 18, y: 10, w: 3, h: 4 };
  const connN: Rect = { x: 10, y: 5, w: 3, h: 2 };
  const connS: Rect = { x: 10, y: 11, w: 3, h: 1 };
  const connNW: Rect = { x: 7, y: 5, w: 3, h: 2 };
  const connNE: Rect = { x: 15, y: 5, w: 2, h: 2 };
  const pool: Rect = { x: 10, y: 7, w: 3, h: 2 };

  return layoutFrom(
    seed,
    "Hexagonal warren",
    [center, north, south, northwest, northeast, southwest, southeast, connN, connS, connNW, connNE],
    optionalWater(random, [pool], 0.30),
    [],
    [north.x + 2, north.y + 1],
    [south.x + south.w - 2, south.y + south.h - 2],
  );
}

function createAsymmetricBranchLayout(seed: string, random: () => number) {
  const trunk: Rect = { x: 5, y: 2, w: 4, h: 13 };
  const leftBranch: Rect = { x: 2, y: 4, w: 4, h: 5 };
  const rightBranch1: Rect = { x: 15, y: 3, w: 5, h: 4 };
  const rightBranch2: Rect = { x: 15, y: 9, w: 5, h: 5 };
  const pools = [
    { x: 3, y: 6, w: 2, h: 2 },
    { x: 18, y: 5, w: 2, h: 2 },
    { x: 18, y: 11, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Asymmetric branching tree" : "Organic tendrils",
    [trunk, leftBranch, rightBranch1, rightBranch2],
    optionalWater(random, pools, 0.30),
    [],
    [trunk.x + 1, trunk.y + 1],
    [rightBranch2.x + rightBranch2.w - 2, rightBranch2.y + rightBranch2.h - 2],
  );
}

function createModularGridLayout(seed: string, random: () => number) {
  const rooms = [
    { x: 2, y: 2, w: 6, h: 5 },
    { x: 9, y: 2, w: 6, h: 5 },
    { x: 16, y: 2, w: 6, h: 5 },
    { x: 2, y: 8, w: 6, h: 6 },
    { x: 9, y: 8, w: 6, h: 6 },
    { x: 16, y: 8, w: 6, h: 6 },
  ];
  const corridors = [
    { x: 8, y: 3, w: 2, h: 3 },
    { x: 15, y: 3, w: 2, h: 3 },
    { x: 8, y: 9, w: 2, h: 4 },
    { x: 15, y: 9, w: 2, h: 4 },
    { x: 3, y: 7, w: 4, h: 2 },
    { x: 10, y: 7, w: 4, h: 2 },
    { x: 17, y: 7, w: 4, h: 2 },
  ];
  const pools = [
    { x: 4, y: 4, w: 2, h: 2 },
    { x: 11, y: 4, w: 2, h: 2 },
    { x: 18, y: 4, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Modular grid chambers",
    [...rooms, ...corridors],
    optionalWater(random, pools, 0.30),
    [],
    [rooms[0].x + 1, rooms[0].y + 1],
    [rooms[5].x + rooms[5].w - 2, rooms[5].y + rooms[5].h - 2],
  );
}

function createPetalChamberLayout(seed: string, random: () => number) {
  const hub: Rect = { x: 10, y: 7, w: 4, h: 3 };
  const petalN: Rect = { x: 10, y: 2, w: 4, h: 4 };
  const petalS: Rect = { x: 10, y: 11, w: 4, h: 4 };
  const petalE: Rect = { x: 16, y: 6, w: 5, h: 5 };
  const petalW: Rect = { x: 3, y: 6, w: 5, h: 5 };
  const petalNE: Rect = { x: 16, y: 2, w: 4, h: 3 };
  const petalNW: Rect = { x: 4, y: 2, w: 4, h: 3 };
  const pools = [
    { x: 11, y: 8, w: 2, h: 2 },
    { x: 18, y: 8, w: 2, h: 2 },
    { x: 4, y: 8, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Petal-arranged chambers",
    [hub, petalN, petalS, petalE, petalW, petalNE, petalNW],
    optionalWater(random, pools, 0.30),
    [],
    [petalN.x + 1, petalN.y + 1],
    [petalS.x + petalS.w - 2, petalS.y + petalS.h - 2],
  );
}

function createAbstractFragmentedLayout(seed: string, random: () => number) {
  // Irregular, scattered room fragments
  const fragments = [
    { x: 2, y: 2, w: 5, h: 6 },
    { x: 8, y: 3, w: 4, h: 4 },
    { x: 13, y: 2, w: 6, h: 5 },
    { x: 3, y: 9, w: 7, h: 5 },
    { x: 12, y: 10, w: 7, h: 4 },
    { x: 5, y: 6, w: 3, h: 2 },
    { x: 11, y: 7, w: 3, h: 2 },
  ];
  const pools = [
    { x: 4, y: 4, w: 2, h: 2 },
    { x: 15, y: 4, w: 2, h: 2 },
    { x: 6, y: 11, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Fragmented labyrinth" : "Scattered chamber debris",
    fragments,
    optionalWater(random, pools, 0.50),
    [],
    [fragments[0].x + 1, fragments[0].y + 1],
    [fragments[4].x + fragments[4].w - 2, fragments[4].y + fragments[4].h - 2],
  );
}

function createAbstractOrganicLayout(seed: string, random: () => number) {
  // Organic, flowing room shapes
  const rooms = [
    { x: 3, y: 3, w: 7, h: 6 },
    { x: 11, y: 2, w: 8, h: 7 },
    { x: 4, y: 10, w: 9, h: 5 },
    { x: 14, y: 10, w: 6, h: 5 },
    { x: 6, y: 7, w: 5, h: 3 },
  ];
  const connectors = [
    { x: 9, y: 5, w: 3, h: 2 },
    { x: 10, y: 9, w: 2, h: 2 },
    { x: 13, y: 8, w: 2, h: 3 },
  ];
  const pools = [
    { x: 5, y: 5, w: 2, h: 2 },
    { x: 16, y: 4, w: 2, h: 2 },
    { x: 8, y: 12, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Organic flowing cavern",
    [...rooms, ...connectors],
    optionalWater(random, pools, 0.50),
    [],
    [rooms[0].x + 1, rooms[0].y + 1],
    [rooms[3].x + rooms[3].w - 2, rooms[3].y + rooms[3].h - 2],
  );
}

function createAbstractIrregularLayout(seed: string, random: () => number) {
  // Highly irregular shape with varied chamber sizes
  const chambers = [
    { x: 2, y: 2, w: 6, h: 4 },
    { x: 9, y: 2, w: 7, h: 3 },
    { x: 17, y: 2, w: 5, h: 6 },
    { x: 2, y: 7, w: 8, h: 8 },
    { x: 11, y: 7, w: 8, h: 8 },
    { x: 4, y: 4, w: 4, h: 2 },
    { x: 14, y: 9, w: 5, h: 4 },
  ];
  const pools = [
    { x: 5, y: 9, w: 3, h: 2 },
    { x: 13, y: 10, w: 3, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Chaotic hall maze" : "Irregular stone warren",
    chambers,
    optionalWater(random, pools, 0.50),
    [],
    [chambers[0].x + 1, chambers[0].y + 1],
    [chambers[4].x + chambers[4].w - 2, chambers[4].y + chambers[4].h - 2],
  );
}

function createAbstractTesselatedLayout(seed: string, random: () => number) {
  // Interlocking irregular tesselated chambers
  const chambers = [
    { x: 2, y: 2, w: 5, h: 5 },
    { x: 8, y: 2, w: 7, h: 4 },
    { x: 16, y: 3, w: 6, h: 6 },
    { x: 3, y: 8, w: 6, h: 7 },
    { x: 10, y: 7, w: 9, h: 8 },
    { x: 6, y: 5, w: 3, h: 2 },
  ];
  const pools = [
    { x: 4, y: 4, w: 2, h: 2 },
    { x: 12, y: 9, w: 2, h: 2 },
    { x: 18, y: 6, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Tesselated abstract cavern",
    chambers,
    optionalWater(random, pools, 0.50),
    [],
    [chambers[0].x + 1, chambers[0].y + 1],
    [chambers[4].x + chambers[4].w - 2, chambers[4].y + chambers[4].h - 2],
  );
}

function createAbstractSpikeLayout(seed: string, random: () => number) {
  // Spiky, branching abstract layout
  const rooms = [
    { x: 10, y: 6, w: 4, h: 5 },
    { x: 2, y: 2, w: 5, h: 3 },
    { x: 17, y: 2, w: 5, h: 3 },
    { x: 2, y: 11, w: 5, h: 4 },
    { x: 17, y: 12, w: 5, h: 3 },
    { x: 9, y: 2, w: 4, h: 3 },
    { x: 11, y: 12, w: 4, h: 3 },
  ];
  const connectors = [
    { x: 10, y: 5, w: 4, h: 2 },
    { x: 6, y: 7, w: 5, h: 2 },
    { x: 13, y: 8, w: 5, h: 2 },
    { x: 10, y: 11, w: 4, h: 2 },
  ];
  const pools = [
    { x: 11, y: 7, w: 2, h: 2 },
    { x: 4, y: 3, w: 2, h: 2 },
    { x: 19, y: 3, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Spiked chaos chamber",
    [...rooms, ...connectors],
    optionalWater(random, pools, 0.50),
    [],
    [rooms[1].x + 1, rooms[1].y + 1],
    [rooms[4].x + rooms[4].w - 2, rooms[4].y + rooms[4].h - 2],
  );
}

function createAbstractVoidsLayout(seed: string, random: () => number) {
  // Abstract with large void spaces between chambers
  const chambers = [
    { x: 2, y: 2, w: 5, h: 5 },
    { x: 17, y: 2, w: 5, h: 5 },
    { x: 9, y: 4, w: 4, h: 4 },
    { x: 2, y: 11, w: 6, h: 4 },
    { x: 16, y: 10, w: 6, h: 5 },
    { x: 8, y: 12, w: 5, h: 3 },
  ];
  const pools = [
    { x: 5, y: 5, w: 3, h: 2 },
    { x: 10, y: 6, w: 2, h: 2 },
    { x: 18, y: 5, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    random() > 0.5 ? "Void-riddled expanse" : "Isolated chamber cluster",
    chambers,
    optionalWater(random, pools, 0.50),
    [],
    [chambers[0].x + 1, chambers[0].y + 1],
    [chambers[4].x + chambers[4].w - 2, chambers[4].y + chambers[4].h - 2],
  );
}

function createAbstractTwinMazesLayout(seed: string, random: () => number) {
  // Two interweaving abstract mazes
  const leftMaze = [
    { x: 2, y: 2, w: 5, h: 4 },
    { x: 2, y: 7, w: 5, h: 7 },
    { x: 4, y: 5, w: 3, h: 2 },
  ];
  const rightMaze = [
    { x: 17, y: 3, w: 5, h: 5 },
    { x: 17, y: 9, w: 5, h: 5 },
    { x: 16, y: 7, w: 3, h: 2 },
  ];
  const centerBridge = [
    { x: 8, y: 5, w: 8, h: 3 },
    { x: 9, y: 9, w: 6, h: 2 },
  ];
  const pools = [
    { x: 3, y: 3, w: 2, h: 2 },
    { x: 19, y: 5, w: 2, h: 2 },
    { x: 10, y: 6, w: 2, h: 2 },
  ];

  return layoutFrom(
    seed,
    "Twin-branched abstract maze",
    [...leftMaze, ...rightMaze, ...centerBridge],
    optionalWater(random, pools, 0.50),
    [],
    [leftMaze[0].x + 1, leftMaze[0].y + 1],
    [rightMaze[1].x + rightMaze[1].w - 2, rightMaze[1].y + rightMaze[1].h - 2],
  );
}

function createLayoutFromSeed(seed: string): RoomLayout {
  const random = createRandom(seed);
  const archetype = randomInt(random, 0, 14);
  // Reduced subrooms frequency — only 2 slots out of 15
  if (archetype === 0) return createSubroomsLayout(seed, random);
  if (archetype === 1) return createSubroomsLayout(seed, random);
  // Abstract layouts only
  if (archetype === 6) return createAbstractFragmentedLayout(seed, random);
  if (archetype === 7) return createAbstractOrganicLayout(seed, random);
  if (archetype === 8) return createAbstractIrregularLayout(seed, random);
  if (archetype === 9) return createAbstractTesselatedLayout(seed, random);
  if (archetype === 10) return createAbstractSpikeLayout(seed, random);
  if (archetype === 11) return createAbstractVoidsLayout(seed, random);
  if (archetype === 12) return createAbstractTwinMazesLayout(seed, random);
  // Size variants
  if (archetype === 13) return createTinyRoomLayout(seed, random);
  return createMassiveHallLayout(seed, random);
}

function createRandomLayout(): RoomLayout {
  const seed = createSeed();
  return createLayoutFromSeed(seed);
}

const inRect = (x: number, y: number, rect: Rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
const hasPoint = (points: Point[], x: number, y: number) => points.some((point) => point.x === x && point.y === y);
const isFloor = (layout: RoomLayout, x: number, y: number) => layout.floorRects.some((rect) => inRect(x, y, rect));
const isWater = (layout: RoomLayout, x: number, y: number) => layout.waterRects.some((rect) => inRect(x, y, rect)) && !hasPoint(layout.bridgeCells, x, y);
const isOpen = (layout: RoomLayout, x: number, y: number) => isFloor(layout, x, y) || isWater(layout, x, y);
const isWalkable = (layout: RoomLayout, x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS && isFloor(layout, x, y) && !isWater(layout, x, y);

function waterTile(layout: RoomLayout, x: number, y: number): TileId {
  const edgeTop = !isWater(layout, x, y - 1);
  const edgeLeft = !isWater(layout, x - 1, y);
  const edgeRight = !isWater(layout, x + 1, y);
  if (edgeTop) return ["H4", "I4", "J4", "K4"][(x + y) % 4];
  if (edgeLeft) return "H5";
  if (edgeRight) return "K5";
  return ["I5", "J5"][(x + y) % 2];
}
const topWallTile = (x: number, y: number) => topWalls[1 + ((x * 3 + y) % 4)];
const bottomWallTile = (x: number, y: number) => bottomCaps[1 + ((x * 5 + y) % 4)];
const sideWallTile = (x: number, y: number, side: "left" | "right") => (side === "left" ? ["A2", "A3", "A4"] : ["F2", "F3", "F4"])[(x + y) % 3];

function wallTileFor(layout: RoomLayout, x: number, y: number): TileId {
  const north = isOpen(layout, x, y - 1), south = isOpen(layout, x, y + 1), west = isOpen(layout, x - 1, y), east = isOpen(layout, x + 1, y);
  const northEast = isOpen(layout, x + 1, y - 1), northWest = isOpen(layout, x - 1, y - 1), southEast = isOpen(layout, x + 1, y + 1), southWest = isOpen(layout, x - 1, y + 1);
  
  // Handle corners - distinguish between perspective (south-facing) and indent (north-facing)
  if (south && east && !north && !west) return "I3"; // perspective corner (bottom-right)
  if (south && west && !north && !east) return "G3"; // perspective corner (bottom-left)
  if (north && east && !south && !west) return "I1"; // indent corner (top-right)
  if (north && west && !south && !east) return "G1"; // indent corner (top-left)
  
  // Handle isolated void cells with only diagonal neighbors
  if (!north && !south && !west && !east) {
    if (southEast) return "A1";
    if (southWest) return "F1";
    if (northEast) return "A5";
    if (northWest) return "F5";
    return voidTile;
  }
  
  // PRIORITIZE LEFT/RIGHT WALLS over perspective walls
  // For vertical wall gaps, choose a more specific tile based on adjacent corners:
  // - K2: vertical gap variant when the east side has a corner and west is straight
  // - L2: vertical gap variant when the west side has a corner and east is straight
  // - J2: fallback vertical gap when neither side shows a dominant corner
  // Consider any void cell flanked east/west as a vertical gap candidate.
  // This is intentionally permissive so K2/L2 can handle corner-dominant
  // vertical gaps even when north or south also touch the gap (zigzags).
  if (east && west) {
    const eastCorner = northEast || southEast;
    const westCorner = northWest || southWest;
    if (eastCorner && !westCorner) return "K2";
    if (westCorner && !eastCorner) return "L2";
    return "J2";
  }
  if (east && !west) return sideWallTile(x, y, "left");
  if (west && !east) return sideWallTile(x, y, "right");
  // If we have any east or west, prefer that over perspective
  if (east) return sideWallTile(x, y, "left");
  if (west) return sideWallTile(x, y, "right");
  
  // Only use perspective walls when there's no east/west
  // A perspective edge must continue through the end of a zigzag turn.
  if (south && !north) return topWallTile(x, y);
  if (north && !south) return bottomWallTile(x, y);
  
  // At a zigzag turn, the final cell of a perspective edge can have a
  // cardinal neighbor along the next leg but only diagonal support beneath it.
  if (!north && !south && (southEast || southWest) && (east || west)) return topWallTile(x, y);
  
  return south ? topWallTile(x, y) : bottomWallTile(x, y);
}
function tileFor(layout: RoomLayout, x: number, y: number): TileId {
  if (!isOpen(layout, x, y)) return wallTileFor(layout, x, y);
  if (isWater(layout, x, y)) return waterTile(layout, x, y);
  if (x === layout.stairsUp[0] && y === layout.stairsUp[1]) return "G4";
  if (x === layout.stairsDown[0] && y === layout.stairsDown[1]) return "G5";
  return floorTiles[(x * 3 + y * 5) % floorTiles.length];
}
const buildRoom = (layout: RoomLayout) => Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => tileFor(layout, x, y)));
function roleFor(tile: TileId) {
  if (tile === voidTile) return "void";
  if (["H4", "I4", "J4", "K4", "H5", "I5", "J5", "K5"].includes(tile)) return "water";
  if (tile === "G4" || tile === "G5") return "stairs";
  if (tile.endsWith("1") && tile !== "H1") return "perspective wall";
  if (tile.startsWith("A") || tile.startsWith("F") || ["A5", "B5", "C5", "D5", "E5", "F5"].includes(tile)) return "wall cap";
  return "floor";
}

export function FirstGeneratedRoom() {
  const [layout, setLayout] = useState<RoomLayout>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const seed = params.get("seed");
      if (seed) return createLayoutFromSeed(seed);
    } catch (e) {
      // ignore in non-browser environments
    }
    return createRandomLayout();
  });
  const [player, setPlayer] = useState<Point>({ x: layout.stairsUp[0], y: layout.stairsUp[1] });
  const [isMobile, setIsMobile] = useState(false);
  const room = useMemo(() => buildRoom(layout), [layout]);
  useEffect(() => setPlayer({ x: layout.stairsUp[0], y: layout.stairsUp[1] }), [layout]);
  useEffect(() => {
    const pointer = window.matchMedia("(pointer: coarse)");
    const update = () => setIsMobile(pointer.matches || window.innerWidth <= 680);
    update(); window.addEventListener("resize", update); pointer.addEventListener?.("change", update);
    return () => { window.removeEventListener("resize", update); pointer.removeEventListener?.("change", update); };
  }, []);
  const movePlayer = useCallback((dx: number, dy: number) => setPlayer((current) => {
    const next = { x: current.x + dx, y: current.y + dy };
    return isWalkable(layout, next.x, next.y) ? next : current;
  }), [layout]);
  useEffect(() => {
    const directions: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 } };
    const onKeyDown = (event: KeyboardEvent) => { const direction = directions[event.key]; if (!direction) return; event.preventDefault(); movePlayer(direction.x, direction.y); };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePlayer]);
  const moveButtons = [{ className: "up", label: "Move up", icon: <ArrowUp size={20} />, dx: 0, dy: -1 }, { className: "left", label: "Move left", icon: <ArrowLeft size={20} />, dx: -1, dy: 0 }, { className: "down", label: "Move down", icon: <ArrowDown size={20} />, dx: 0, dy: 1 }, { className: "right", label: "Move right", icon: <ArrowRight size={20} />, dx: 1, dy: 0 }];
  return (
    <main className="room-shell">
      <section className="room-frame">
         <header className="room-header"><div><p className="eyebrow">Room generator / shape study</p><h1 className="room-title">{layout.name}</h1><p className="room-subtitle">A varied chamber network assembled from 25 abstract footprint families. Floors remain continuous through halls, while surrounding wall edges define each newly generated shape.</p></div><button className="regen" type="button" onClick={() => setLayout(createRandomLayout())}><RefreshCw size={14} strokeWidth={2.5} /> Regenerate room</button></header>
        <div className="room-body">
          <div className="map-stage" aria-label={`${layout.name} tile preview`}><div className="map">{room.flatMap((row, y) => row.map((tile, x) => <img className="tile" key={`${x}-${y}-${tile}`} src={`${TILE_ROOT}/${tile}.png`} alt={`${tile}, ${roleFor(tile)}, grid ${x + 1} by ${y + 1}`} title={`${tile} · ${roleFor(tile)}`} />))}<div className="player-sprite" style={{ left: player.x * 32, top: player.y * 32 }} role="img" aria-label={`Pill character at grid ${player.x + 1} by ${player.y + 1}`}><span className="player-label">P1</span></div></div></div>
           <div className="under-map"><span><strong>SEED {layout.seed}</strong> · {COLS} × {ROWS} cells · fresh layout</span><span aria-live="polite">PILL {player.x + 1},{player.y + 1} · {isMobile ? "touch controls active" : "arrow keys / WASD"}</span></div>
          <div className="controls" aria-label="Movement instructions"><span><strong>Move the pill</strong> with arrow keys or WASD.</span><span>Walls and water block movement · bridges remain open.</span></div>
          <div className="mobile-controls" style={isMobile ? { display: "grid" } : undefined} aria-label="Touch movement controls">{moveButtons.map((button) => <button className={`move-button ${button.className}`} key={button.label} type="button" aria-label={button.label} onClick={() => movePlayer(button.dx, button.dy)}>{button.icon}</button>)}</div>
           <div className="specs"><div className="spec"><div className="spec-label"><Ruler size={12} /> Native scale</div><div className="spec-value">32 × 32 CSS px / tile</div></div><div className="spec"><div className="spec-label"><Droplets size={12} /> Water pockets</div><div className="spec-value">{layout.waterRects.length ? `${layout.waterRects.map((rect) => `${rect.w} × ${rect.h}`).join(" · ")} floor bridges` : "dry footprint"}</div></div><div className="spec"><div className="spec-label"><Sparkles size={12} /> Tile source</div><div className="spec-value">32 × 32 PNG atlas</div></div></div>
          <div className="legend"><span className="legend-item"><i className="swatch" /> floor + wall cap</span><span className="legend-item"><i className="swatch water" /> water + edge transition</span><span className="legend-item"><i className="swatch stairs" /> ascending / descending</span></div>
           <p className="note">Generation rule: floors stay on the room footprint and walls occupy the surrounding void. One-tile notches and gaps are filled automatically, so every indent remains at least two tiles wide. Top edges use perspective pieces, side and lower edges use thin caps, and corner pieces appear only where a boundary actually turns.</p>
        </div>
      </section>
    </main>
  );
}
export default FirstGeneratedRoom;