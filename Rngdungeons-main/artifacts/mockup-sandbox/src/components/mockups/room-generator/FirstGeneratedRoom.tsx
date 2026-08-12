import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Droplets, RefreshCw, Ruler, Sparkles } from "lucide-react";

type TileId = string;

const TILE_ROOT = "/__mockup/images/tileset";
const COLS = 24;
const ROWS = 17;

const floorTiles = ["B2", "C2", "D2", "E2", "B3", "C3", "D3", "E3", "B4", "C4", "D4", "E4"];
const topWalls = ["A1", "B1", "C1", "D1", "E1", "F1"];
const bottomCaps = ["A5", "B5", "C5", "D5", "E5", "F5"];
const voidTile = "H2";

type RoomLayout = {
  name: string;
  seed: string;
  floorRects: Rect[];
  cutCells?: Point[];
  waterRects: Rect[];
  bridgeCells: Point[];
  stairsUp: [number, number];
  stairsDown: [number, number];
};

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const layouts: RoomLayout[] = [
  {
    name: "Flooded antechamber",
    seed: "A-017",
    floorRects: [
      { x: 2, y: 3, w: 12, h: 9 },
      { x: 13, y: 8, w: 6, h: 2 },
      { x: 17, y: 5, w: 6, h: 7 },
      { x: 7, y: 12, w: 2, h: 4 },
    ],
    // This layout keeps its clean rectangular chambers as the "no cut" case.
    waterRects: [{ x: 5, y: 6, w: 5, h: 5 }],
    bridgeCells: Array.from({ length: 5 }, (_, index) => ({ x: 5 + index, y: 8 })),
    stairsUp: [3, 10],
    stairsDown: [19, 8],
  },
  {
    name: "Twin stair cistern",
    seed: "B-042",
    floorRects: [
      { x: 3, y: 3, w: 9, h: 9 },
      { x: 11, y: 7, w: 7, h: 2 },
      { x: 16, y: 4, w: 7, h: 8 },
      { x: 6, y: 11, w: 2, h: 5 },
    ],
    // Corner cuts are deliberately occasional, not a rule for every room.
    cutCells: [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 21, y: 11 },
      { x: 22, y: 11 },
    ],
    waterRects: [{ x: 4, y: 5, w: 4, h: 4 }],
    bridgeCells: Array.from({ length: 4 }, (_, index) => ({ x: 4 + index, y: 7 })),
    stairsUp: [5, 10],
    stairsDown: [20, 7],
  },
  {
    name: "The low vault",
    seed: "C-083",
    floorRects: [
      { x: 2, y: 4, w: 10, h: 7 },
      { x: 11, y: 8, w: 5, h: 2 },
      { x: 14, y: 5, w: 9, h: 7 },
      { x: 5, y: 10, w: 2, h: 6 },
    ],
    cutCells: [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 21, y: 11 },
    ],
    waterRects: [{ x: 5, y: 5, w: 4, h: 4 }],
    bridgeCells: Array.from({ length: 4 }, (_, index) => ({ x: 5 + index, y: 7 })),
    stairsUp: [3, 9],
    stairsDown: [19, 8],
  },
];

function imageFor(tile: TileId) {
  return `${TILE_ROOT}/${tile}.png`;
}

function inRect(x: number, y: number, rect: Rect) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function hasPoint(points: Point[], x: number, y: number) {
  return points.some((point) => point.x === x && point.y === y);
}

function isFloor(layout: RoomLayout, x: number, y: number) {
  return (
    layout.floorRects.some((rect) => inRect(x, y, rect)) &&
    !hasPoint(layout.cutCells ?? [], x, y)
  );
}

function isWater(layout: RoomLayout, x: number, y: number) {
  return layout.waterRects.some((rect) => inRect(x, y, rect)) && !hasPoint(layout.bridgeCells, x, y);
}

function isOpen(layout: RoomLayout, x: number, y: number) {
  return isFloor(layout, x, y) || isWater(layout, x, y);
}

function isWalkable(layout: RoomLayout, x: number, y: number) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && isFloor(layout, x, y) && !isWater(layout, x, y);
}

function waterTile(layout: RoomLayout, x: number, y: number): TileId {
  const edgeTop = !isWater(layout, x, y - 1);
  const edgeLeft = !isWater(layout, x - 1, y);
  const edgeRight = !isWater(layout, x + 1, y);
  if (edgeTop) return ["H4", "I4", "J4", "K4"][(x + y) % 4];
  if (edgeLeft) return "H5";
  if (edgeRight) return "K5";
  return ["I5", "J5"][(x + y) % 2];
}

function topWallTile(x: number, y: number): TileId {
  return topWalls[1 + ((x * 3 + y) % 4)];
}

function bottomWallTile(x: number, y: number): TileId {
  return bottomCaps[1 + ((x * 5 + y) % 4)];
}

function sideWallTile(x: number, y: number, side: "left" | "right"): TileId {
  const variants = side === "left" ? ["A2", "A3", "A4"] : ["F2", "F3", "F4"];
  return variants[(x + y) % variants.length];
}

/**
 * Walls are placed in void cells adjacent to the floor footprint. Previously
 * boundary floor cells were swapped for walls, which made a two-cell strip
 * entirely wall and made hallways appear disconnected.
 */
function wallTileFor(layout: RoomLayout, x: number, y: number): TileId {
  const north = isOpen(layout, x, y - 1);
  const south = isOpen(layout, x, y + 1);
  const west = isOpen(layout, x - 1, y);
  const east = isOpen(layout, x + 1, y);

  // A corner is one cell diagonally outside the footprint. This keeps the
  // corner tile outside the room instead of stretching a perspective tile
  // over the first/last floor cell.
  const northEast = isOpen(layout, x + 1, y - 1);
  const northWest = isOpen(layout, x - 1, y - 1);
  const southEast = isOpen(layout, x + 1, y + 1);
  const southWest = isOpen(layout, x - 1, y + 1);

  if (!north && !south && !west && !east) {
    if (southEast) return "A1";
    if (southWest) return "F1";
    if (northEast) return "A5";
    if (northWest) return "F5";
    return voidTile;
  }

  // The top-facing perspective wall is only used on the outside edge. The
  // side and bottom edges use the thin atlas pieces.
  if (south && !north) return topWallTile(x, y);
  if (north && !south) return bottomWallTile(x, y);
  if (east && !west) return sideWallTile(x, y, "left");
  if (west && !east) return sideWallTile(x, y, "right");

  // Resolve unusual concave junctions to a thin wall rather than allowing a
  // perspective tile to overlap a floor.
  if (east) return sideWallTile(x, y, "left");
  if (west) return sideWallTile(x, y, "right");
  return south ? topWallTile(x, y) : bottomWallTile(x, y);
}

function tileFor(layout: RoomLayout, x: number, y: number): TileId {
  if (isOpen(layout, x, y)) {
    if (isWater(layout, x, y)) return waterTile(layout, x, y);
    if (x === layout.stairsUp[0] && y === layout.stairsUp[1]) return "G4";
    if (x === layout.stairsDown[0] && y === layout.stairsDown[1]) return "G5";
    return floorTiles[(x * 3 + y * 5) % floorTiles.length];
  }

  return wallTileFor(layout, x, y);
}

function buildRoom(layout: RoomLayout) {
  return Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => tileFor(layout, x, y)),
  );
}

function roleFor(tile: TileId) {
  if (tile === voidTile) return "void";
  if (["H4", "I4", "J4", "K4", "H5", "I5", "J5", "K5"].includes(tile)) return "water";
  if (tile === "G4" || tile === "G5") return "stairs";
  if (tile.endsWith("1") && tile !== "H1") return "perspective wall";
  if (tile.startsWith("A") || tile.startsWith("F") || ["A5", "B5", "C5", "D5", "E5", "F5"].includes(tile)) return "wall cap";
  return "floor";
}

export function FirstGeneratedRoom() {
  const [layoutIndex, setLayoutIndex] = useState(0);
  const [player, setPlayer] = useState<Point>({ x: layouts[0].stairsUp[0], y: layouts[0].stairsUp[1] });
  const [isMobile, setIsMobile] = useState(false);
  const layout = layouts[layoutIndex];
  const room = useMemo(() => buildRoom(layout), [layout]);

  useEffect(() => {
    setPlayer({ x: layout.stairsUp[0], y: layout.stairsUp[1] });
  }, [layout]);

  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const updateMobileState = () => setIsMobile(coarsePointer.matches || window.innerWidth <= 680);
    updateMobileState();
    window.addEventListener("resize", updateMobileState);
    coarsePointer.addEventListener?.("change", updateMobileState);
    return () => {
      window.removeEventListener("resize", updateMobileState);
      coarsePointer.removeEventListener?.("change", updateMobileState);
    };
  }, []);

  const movePlayer = useCallback((dx: number, dy: number) => {
    setPlayer((current) => {
      const next = { x: current.x + dx, y: current.y + dy };
      return isWalkable(layout, next.x, next.y) ? next : current;
    });
  }, [layout]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const directions: Record<string, Point> = {
        ArrowUp: { x: 0, y: -1 },
        w: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        s: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        a: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        d: { x: 1, y: 0 },
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      movePlayer(direction.x, direction.y);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePlayer]);

  return (
    <main className="room-shell">
      <style>{`
        .room-shell { min-height:100vh; background:#11151b; color:#e9e0cc; padding:28px; font-family:'Space Mono', ui-monospace, monospace; }
        .room-frame { max-width:1120px; margin:0 auto; border:1px solid #394149; background:#1a2027; box-shadow:0 22px 70px rgba(0,0,0,.35); }
        .room-header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:25px 28px 22px; border-bottom:1px solid #394149; }
        .eyebrow { margin:0 0 8px; color:#d3a85f; font-size:10px; letter-spacing:.18em; text-transform:uppercase; }
        .room-title { margin:0; color:#f4eedf; font:600 30px/1.05 Georgia, serif; letter-spacing:-.03em; }
        .room-subtitle { margin:9px 0 0; color:#8e9aa0; font-size:11px; line-height:1.6; max-width:530px; }
        .regen { display:flex; align-items:center; gap:9px; border:1px solid #bd8d45; background:#bd8d45; color:#161a1e; padding:11px 14px; font:700 11px 'Space Mono',monospace; cursor:pointer; text-transform:uppercase; letter-spacing:.06em; }
        .regen:hover { background:#d7ad67; }
        .room-body { padding:24px 28px 28px; }
        .map-stage { overflow:auto; border:1px solid #4b5559; background:#0d1014; padding:22px; }
         .map { display:grid; grid-template-columns:repeat(${COLS}, 32px); grid-template-rows:repeat(${ROWS}, 32px); width:max-content; margin:auto; image-rendering:pixelated; image-rendering:crisp-edges; box-shadow:0 0 0 7px #20272d, 0 0 0 8px #59635f; position:relative; }
        .tile { width:32px; height:32px; display:block; image-rendering:pixelated; image-rendering:crisp-edges; }
        .tile:hover { outline:1px solid #e1bc78; outline-offset:-1px; position:relative; z-index:1; }
         .player-sprite { position:absolute; z-index:3; width:24px; height:28px; margin:2px 4px; border:2px solid #19151a; border-radius:50% 50% 42% 42%; background:linear-gradient(90deg,#f08c83 0 28%,#f8c3a0 28% 72%,#e57d78 72%); box-shadow:0 2px 0 #0b0d10, inset 0 -5px 0 rgba(153,54,76,.38); pointer-events:none; transition:transform 100ms ease-out; }
         .player-sprite::before { content:""; position:absolute; left:5px; top:7px; width:4px; height:4px; border-radius:50%; background:#231c25; box-shadow:8px 0 #231c25; }
         .player-sprite::after { content:""; position:absolute; left:8px; bottom:5px; width:5px; height:2px; border-radius:50%; background:#8e485a; }
         .player-label { position:absolute; z-index:4; left:50%; top:-19px; transform:translateX(-50%); color:#f8cf85; font:700 8px/1 'Space Mono',monospace; letter-spacing:.08em; text-shadow:0 1px #11151b; pointer-events:none; }
        .under-map { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:18px; color:#849095; font-size:10px; }
        .under-map strong { color:#e3d3b2; font-weight:400; }
         .controls { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:18px; padding:13px 15px; border:1px solid #394149; background:#171d23; color:#87939a; font-size:10px; }
         .controls strong { color:#f1e5ca; font-weight:400; }
         .mobile-controls { display:none; grid-template-columns:repeat(3,44px); grid-template-rows:repeat(2,44px); justify-content:center; gap:6px; margin-top:18px; }
         .move-button { display:flex; align-items:center; justify-content:center; border:1px solid #6e5940; border-radius:5px; background:#2a2522; color:#f1c879; touch-action:manipulation; user-select:none; -webkit-tap-highlight-color:transparent; }
         .move-button:active { background:#bd8d45; color:#171a1e; transform:translateY(1px); }
         .move-button.up { grid-column:2; grid-row:1; }
         .move-button.left { grid-column:1; grid-row:2; }
         .move-button.down { grid-column:2; grid-row:2; }
         .move-button.right { grid-column:3; grid-row:2; }
        .specs { display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:1px; margin-top:22px; background:#394149; border:1px solid #394149; }
        .spec { background:#20272d; padding:16px; min-height:73px; }
        .spec-label { display:flex; align-items:center; gap:7px; color:#748188; font-size:9px; letter-spacing:.12em; text-transform:uppercase; }
        .spec-value { margin-top:9px; color:#f1e5ca; font-size:12px; }
        .legend { display:flex; align-items:center; flex-wrap:wrap; gap:16px; margin-top:18px; color:#849095; font-size:10px; }
        .legend-item { display:flex; align-items:center; gap:7px; }
        .swatch { width:8px; height:8px; border:1px solid #c7ad7d; background:#c7ad7d; }
        .swatch.water { background:#5d94a0; border-color:#83bbc0; }
        .swatch.stairs { background:#bd8d45; border-color:#e5bd74; }
        .note { margin:19px 0 0; padding:13px 15px; border-left:2px solid #bd8d45; color:#aeb5af; font-size:10px; line-height:1.7; background:#1c2329; }
         @media (max-width:680px) { .room-shell{padding:12px}.room-header{padding:20px;display:block}.regen{margin-top:18px}.room-body{padding:16px}.room-title{font-size:26px}.specs{grid-template-columns:1fr}.under-map{display:block;line-height:1.8}.mobile-controls{display:grid}.controls{display:block;line-height:1.7}.controls span{display:block}.controls span + span{margin-top:4px} }
      `}</style>
      <section className="room-frame">
        <header className="room-header">
          <div>
            <p className="eyebrow">Room generator / first pass</p>
            <h1 className="room-title">{layout.name}</h1>
            <p className="room-subtitle">An abstract chamber network assembled from the labeled atlas. Floors remain continuous through halls, while surrounding wall edges and occasional corner cuts keep each room inside its footprint.</p>
          </div>
          <button className="regen" type="button" onClick={() => setLayoutIndex((index) => (index + 1) % layouts.length)}>
            <RefreshCw size={14} strokeWidth={2.5} /> Regenerate room
          </button>
        </header>
        <div className="room-body">
          <div className="map-stage" aria-label={`${layout.name} tile preview`}>
            <div className="map">
              {room.flatMap((row, y) => row.map((tile, x) => (
                <img className="tile" key={`${x}-${y}-${tile}`} src={imageFor(tile)} alt={`${tile}, ${roleFor(tile)}, grid ${x + 1} by ${y + 1}`} title={`${tile} · ${roleFor(tile)}`} />
              )))}
              <div
                className="player-sprite"
                style={{ left: player.x * 32, top: player.y * 32 }}
                role="img"
                aria-label={`Pill character at grid ${player.x + 1} by ${player.y + 1}`}
              >
                <span className="player-label">P1</span>
              </div>
            </div>
          </div>
          <div className="under-map">
            <span><strong>SEED {layout.seed}</strong> · {COLS} × {ROWS} cells · deterministic layout</span>
            <span aria-live="polite">PILL {player.x + 1},{player.y + 1} · {isMobile ? "touch controls active" : "arrow keys / WASD"}</span>
          </div>
          <div className="controls" aria-label="Movement instructions">
            <span><strong>Move the pill</strong> with arrow keys or WASD.</span>
            <span>Walls and water block movement · bridges remain open.</span>
          </div>
          <div className="mobile-controls" style={isMobile ? { display: "grid" } : undefined} aria-label="Touch movement controls">
            <button className="move-button up" type="button" aria-label="Move up" onClick={() => movePlayer(0, -1)}><ArrowUp size={20} /></button>
            <button className="move-button left" type="button" aria-label="Move left" onClick={() => movePlayer(-1, 0)}><ArrowLeft size={20} /></button>
            <button className="move-button down" type="button" aria-label="Move down" onClick={() => movePlayer(0, 1)}><ArrowDown size={20} /></button>
            <button className="move-button right" type="button" aria-label="Move right" onClick={() => movePlayer(1, 0)}><ArrowRight size={20} /></button>
          </div>
          <div className="specs">
            <div className="spec"><div className="spec-label"><Ruler size={12} /> Native scale</div><div className="spec-value">32 × 32 CSS px / tile</div></div>
            <div className="spec"><div className="spec-label"><Droplets size={12} /> Water pockets</div><div className="spec-value">{layout.waterRects.map((rect) => `${rect.w} × ${rect.h}`).join(" · ")} floor bridges</div></div>
            <div className="spec"><div className="spec-label"><Sparkles size={12} /> Tile source</div><div className="spec-value">32 × 32 PNG atlas</div></div>
          </div>
          <div className="legend">
            <span className="legend-item"><i className="swatch" /> floor + wall cap</span>
            <span className="legend-item"><i className="swatch water" /> water + edge transition</span>
            <span className="legend-item"><i className="swatch stairs" /> ascending / descending</span>
          </div>
           <p className="note">Generation rule: floors stay on the room footprint and walls occupy the surrounding void. Top edges use perspective pieces, side and lower edges use thin caps, and corner pieces appear only where a boundary actually turns.</p>
        </div>
      </section>
    </main>
  );
}

export default FirstGeneratedRoom;