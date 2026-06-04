import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, RefreshCw, Send, Sparkles, Trash2, Trees } from "lucide-react";
import {
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { db, firebaseReady } from "./services/firebase";
import "./styles.css";

const LEAF_COLORS = ["#2f8f46", "#74b84f", "#a7c957"];
const TREE_WIDTH = 1200;
const TREE_HEIGHT = 760;

const CANOPY_CENTER = { x: 610, y: 285 };
const CANOPY_RADIUS = { x: 465, y: 255 };
const CANOPY_CLIP_ID = "wish-tree-canopy-clip";
const DEFAULT_CANOPY_PATH = "M122,334 C145,188 292,93 475,92 C522,38 697,38 746,92 C928,94 1075,188 1098,334 C1117,455 1006,539 844,516 C770,575 452,575 376,516 C214,539 103,455 122,334 Z";
const LEAF_SAFE_BOUNDS = { minX: 175, maxX: 1025, minY: 70, maxY: 525 };

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function hashText(text) {
  return [...text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function createLeafPlacement(name, count) {
  const random = seededRandom(hashText(`${name}-${Date.now()}-${count}`));
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random());

  return {
    x: Math.round(CANOPY_CENTER.x + Math.cos(angle) * radius * CANOPY_RADIUS.x),
    y: Math.round(CANOPY_CENTER.y + Math.sin(angle) * radius * CANOPY_RADIUS.y),
    color: LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)],
  };
}

function createTreeSlots(count, shapePoints = []) {
  const columns = Math.min(20, Math.max(10, Math.ceil(Math.sqrt(Math.max(count, 1)) * 1.7)));
  const rows = Math.max(1, Math.ceil(count / columns) + 2);
  const slots = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const normalizedX = columns === 1 ? 0 : column / (columns - 1);
      const normalizedY = rows === 1 ? 0 : row / (rows - 1);
      const x = 120 + normalizedX * 980;
      const y = 75 + normalizedY * 460;

      if (isInsideActiveShape(x, y, shapePoints)) {
        slots.push({
          x,
          y,
        });
      }
    }
  }

  return slots.length ? slots : [CANOPY_CENTER];
}

function isInsideActiveShape(x, y, shapePoints = []) {
  if (!isInsideLeafSafeArea(x, y)) return false;
  if (shapePoints.length > 2) return isPointInPolygon({ x, y }, shapePoints);
  return isInsideCanopyShape(x, y);
}

function isInsideLeafSafeArea(x, y) {
  const insideBounds = x >= LEAF_SAFE_BOUNDS.minX
    && x <= LEAF_SAFE_BOUNDS.maxX
    && y >= LEAF_SAFE_BOUNDS.minY
    && y <= LEAF_SAFE_BOUNDS.maxY;
  const trunkBody = x > 500 && x < 720 && y > 315;
  const trunkTop = ((x - 610) / 145) ** 2 + ((y - 360) / 92) ** 2 < 1;

  return insideBounds && !trunkBody && !trunkTop;
}

function isInsideCanopyShape(x, y) {
  const upperCrown = ((x - 610) / 500) ** 2 + ((y - 260) / 230) ** 2 <= 1;
  const leftShoulder = ((x - 405) / 235) ** 2 + ((y - 345) / 185) ** 2 <= 1;
  const rightShoulder = ((x - 815) / 235) ** 2 + ((y - 345) / 185) ** 2 <= 1;
  const lowerCenter = ((x - 610) / 265) ** 2 + ((y - 430) / 125) ** 2 <= 1;
  const trunkGap = x > 535 && x < 685 && y > 455;

  return (upperCrown || leftShoulder || rightShoulder || lowerCenter) && !trunkGap;
}

function isPointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function shapePointsToPath(points) {
  if (!points?.length) return DEFAULT_CANOPY_PATH;
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")} Z`;
}

function createTreePlacement(leafItem, index, total, salt = "", shapePoints = []) {
  const slots = createTreeSlots(total, shapePoints);
  const slotIndex = (index + hashText(`${leafItem.id || leafItem.name}-${salt}`)) % slots.length;
  const slot = slots[slotIndex];
  const jitterX = ((hashText(`${leafItem.id}-x-${salt}`) % 100) - 50) * 0.3;
  const jitterY = ((hashText(`${leafItem.id}-y-${salt}`) % 100) - 50) * 0.2;

  return {
    x: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxX, Math.max(LEAF_SAFE_BOUNDS.minX, slot.x + jitterX))),
    y: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxY, Math.max(LEAF_SAFE_BOUNDS.minY, slot.y + jitterY))),
    rotate: (hashText(`${leafItem.id}-${salt}`) % 70) - 35,
  };
}

function moveShapePoints(points, dx, dy) {
  return points.map((point) => ({
    x: Math.round(Math.min(1110, Math.max(90, point.x + dx))),
    y: Math.round(Math.min(555, Math.max(45, point.y + dy))),
  }));
}

function useLeaves() {
  const [leaves, setLeaves] = useState([]);
  const [status, setStatus] = useState(firebaseReady ? "connecting" : "missing-config");

  useEffect(() => {
    if (!firebaseReady) return undefined;

    try {
      const leavesRef = ref(db, "leaves");
      return onValue(
        leavesRef,
        (snapshot) => {
          const data = snapshot.val() || {};
          const nextLeaves = Object.entries(data)
            .map(([id, leafItem]) => ({ id, ...leafItem }))
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
          setLeaves(nextLeaves);
          setStatus("connected");
        },
        (error) => {
          console.error("Realtime Database listener failed:", error);
          setStatus("error");
        },
      );
    } catch (error) {
      console.error("Realtime Database setup failed:", error);
      setStatus("error");
      return undefined;
    }
  }, []);

  return { leaves, status };
}

function useCanopyShape() {
  const [shapePoints, setShapePoints] = useState([]);

  useEffect(() => {
    if (!firebaseReady) return undefined;

    return onValue(ref(db, "settings/canopyShape"), (snapshot) => {
      const points = snapshot.val();
      setShapePoints(Array.isArray(points) ? points : []);
    });
  }, []);

  return shapePoints;
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("App render failed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-[#f5f0e6] px-5 text-[#173b27]">
          <section className="w-full max-w-md rounded-lg border border-[#d6c8a7] bg-white p-5 shadow-glow">
            <h1 className="text-2xl font-black">Digital Tree of Wishes</h1>
            <p className="mt-3 text-sm font-semibold text-[#6f765f]">
              The app hit a browser runtime error. Check the console for the exact message.
            </p>
            <pre className="mt-4 overflow-auto rounded-md bg-[#173b27] p-3 text-xs text-white">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function App() {
  const path = window.location.pathname;
  if (path === "/admin") return <AdminPage />;
  if (path === "/display") return <DisplayPage />;
  return <SubmitPage />;
}

function SubmitPage() {
  const { leaves, status } = useLeaves();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");

    if (!cleanName) {
      setError("Name is required.");
      return;
    }
    if (cleanName.length > 20) {
      setError("Use 20 characters or fewer.");
      return;
    }
    if (!firebaseReady) {
      setError("Firebase config is missing.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const placement = createLeafPlacement(cleanName, leaves.length);
      const leafRef = push(ref(db, "leaves"));
      await set(leafRef, {
        name: cleanName,
        createdAt: serverTimestamp(),
        ...placement,
      });
      setName("");
      setSent(true);
      window.setTimeout(() => setSent(false), 2600);
    } catch {
      setError("Could not send your wish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f0e6] text-[#173b27]">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-full bg-[#173b27] text-white shadow-glow">
            <Trees size={26} />
          </div>
          <h1 className="text-3xl font-black leading-tight">Trees</h1>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-[#d6c8a7] bg-white/78 p-5 shadow-glow backdrop-blur">
          <label className="mb-2 block text-sm font-bold" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            maxLength={20}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            className="h-14 w-full rounded-md border border-[#b8c08c] bg-white px-4 text-lg font-semibold outline-none transition focus:border-[#2f8f46] focus:ring-4 focus:ring-[#a7c957]/25"
            placeholder="Enter name"
            autoComplete="name"
          />
          <div className="mt-2 flex justify-between text-xs font-semibold text-[#6f765f]">
            <span>{error || (status === "connected" ? "Ready to grow a tree." : "Connecting...")}</span>
            <span>{name.trim().length}/20</span>
          </div>
          <button
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[#173b27] px-5 text-base font-black text-white transition hover:bg-[#22583a] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            <Send size={19} />
            {busy ? "Sending" : "Add My Tree"}
          </button>
        </form>

        <AnimatePresence>
          {sent && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="mt-5 flex items-center gap-2 rounded-md bg-[#dce9b4] px-4 py-3 text-sm font-bold"
            >
              <Sparkles size={17} />
              Your tree is now live.
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}

function DisplayPage() {
  const { leaves, status } = useLeaves();
  const shapePoints = useCanopyShape();
  const previousIds = useRef(new Set());
  const [newestId, setNewestId] = useState(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const activeShape = draftPoints.length > 2 ? draftPoints : shapePoints;
  const arrangedLeaves = useMemo(() => arrangeLeaves(leaves, shapePoints), [leaves, shapePoints]);
  const newestLeaf = arrangedLeaves.find((leafItem) => leafItem.id === newestId) || arrangedLeaves.at(-1);

  useEffect(() => {
    const currentIds = new Set(leaves.map((leafItem) => leafItem.id));
    const added = leaves.find((leafItem) => !previousIds.current.has(leafItem.id));
    if (added && previousIds.current.size) setNewestId(added.id);
    previousIds.current = currentIds;
  }, [leaves]);

  useEffect(() => {
    async function handleKeyDown(event) {
      if (event.key === "5") {
        setDrawingMode((current) => !current);
        setDraftPoints([]);
        setIsDrawing(false);
        return;
      }

      if (!drawingMode || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        return;
      }

      event.preventDefault();
      const delta = event.shiftKey ? 28 : 12;
      const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
      const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
      const sourcePoints = draftPoints.length > 2 ? draftPoints : shapePoints;

      if (sourcePoints.length > 2) {
        const movedPoints = moveShapePoints(sourcePoints, dx, dy);
        setDraftPoints(movedPoints);
        if (firebaseReady) await set(ref(db, "settings/canopyShape"), movedPoints);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawingMode, draftPoints, shapePoints]);

  function getSvgPoint(event) {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: Math.round(Math.min(TREE_WIDTH, Math.max(0, transformed.x))),
      y: Math.round(Math.min(TREE_HEIGHT, Math.max(0, transformed.y))),
    };
  }

  function startDrawing(event) {
    if (!drawingMode) return;
    const point = getSvgPoint(event);
    setDraftPoints([point]);
    setIsDrawing(true);
  }

  function drawPoint(event) {
    if (!drawingMode || !isDrawing) return;
    const point = getSvgPoint(event);
    setDraftPoints((points) => {
      const last = points.at(-1);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 8) return points;
      return [...points, point];
    });
  }

  async function finishDrawing() {
    if (!drawingMode || !isDrawing) return;
    setIsDrawing(false);

    if (draftPoints.length > 8 && firebaseReady) {
      await set(ref(db, "settings/canopyShape"), draftPoints);
    }
  }

  return (
    <main className="display-shell">
      <div className="display-hud">
        <div>
          <h1 className="text-4xl font-black leading-none text-[#173b27]">{leaves.length} trees</h1>
        </div>
        <div className="newest-leaf">
          <Leaf size={18} />
          <span>{newestLeaf?.name || (status === "connected" ? "Waiting for wishes" : "Connecting")}</span>
        </div>
      </div>

      {drawingMode && (
        <div className="draw-shape-hint">
          Draw shape. Release to save. Arrow keys move it. Press 5 to exit.
        </div>
      )}

      <svg
        className={`tree-stage ${drawingMode ? "is-drawing-shape" : ""}`}
        viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`}
        role="img"
        aria-label="Digital wish tree"
        onPointerDown={startDrawing}
        onPointerMove={drawPoint}
        onPointerUp={finishDrawing}
        onPointerLeave={finishDrawing}
      >
        <TreeSvg shapePoints={activeShape} showShapeGuide={drawingMode} />
        <g clipPath={`url(#${CANOPY_CLIP_ID})`}>
          <AnimatePresence>
            {arrangedLeaves.map((leafItem) => (
              <WishLeaf key={leafItem.id} leaf={leafItem} isNewest={leafItem.id === newestId} />
            ))}
          </AnimatePresence>
        </g>
      </svg>
    </main>
  );
}

function AdminPage() {
  const { leaves, status } = useLeaves();
  const shapePoints = useCanopyShape();
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function deleteLeaf(id) {
    if (!firebaseReady) return;
    setBusyId(id);
    setMessage("");

    try {
      await remove(ref(db, `leaves/${id}`));
      setMessage("Leaf deleted.");
    } catch {
      setMessage("Could not delete leaf. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteAllLeaves() {
    if (!firebaseReady || !window.confirm("Delete all leaves?")) return;
    setBusyId("all");
    setMessage("");

    try {
      await remove(ref(db, "leaves"));
      setMessage("All leaves deleted.");
    } catch {
      setMessage("Could not delete all leaves. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function rearrangeLeaves() {
    if (!firebaseReady) return;
    setBusyId("rearrange");
    setMessage("");

    try {
      const updates = {};
      const salt = String(Date.now());
      leaves.forEach((leafItem, index) => {
        const placement = createTreePlacement(leafItem, index, leaves.length, salt, shapePoints);
        updates[`leaves/${leafItem.id}/x`] = placement.x;
        updates[`leaves/${leafItem.id}/y`] = placement.y;
        updates[`leaves/${leafItem.id}/rotate`] = placement.rotate;
      });
      await update(ref(db), updates);
      setMessage("Leaves rearranged.");
    } catch {
      setMessage("Could not rearrange leaves. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="min-h-screen bg-[#eef4e6] px-5 py-6 text-[#173b27]">
      <section className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-[#77834c]">
              Digital Tree of Wishes
            </p>
            <h1 className="text-4xl font-black">Admin</h1>
            <p className="mt-1 text-sm font-bold text-[#60704a]">
              {status === "connected" ? `${leaves.length} leaves loaded` : "Connecting to database"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={rearrangeLeaves}
              disabled={!leaves.length || busyId === "rearrange"}
              className="admin-button bg-[#173b27] text-white hover:bg-[#22583a]"
            >
              <RefreshCw size={18} />
              {busyId === "rearrange" ? "Rearranging" : "Rearrange"}
            </button>
            <button
              type="button"
              onClick={deleteAllLeaves}
              disabled={!leaves.length || busyId === "all"}
              className="admin-button border border-[#c75a3a] bg-white text-[#9f2f1d] hover:bg-[#fff2ed]"
            >
              <Trash2 size={18} />
              Delete All
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-md border border-[#c6d49f] bg-white px-4 py-3 text-sm font-bold">
            {message}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-[#c6d49f] bg-white shadow-glow">
          <div className="grid grid-cols-[1fr_110px_110px] gap-3 border-b border-[#dbe4c5] bg-[#f8fbf3] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-[#60704a]">
            <span>Name</span>
            <span>Color</span>
            <span className="text-right">Action</span>
          </div>

          {leaves.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm font-bold text-[#60704a]">
              No leaves yet.
            </div>
          ) : (
            <div className="max-h-[68vh] overflow-auto">
              {leaves.map((leafItem) => (
                <div
                  key={leafItem.id}
                  className="grid grid-cols-[1fr_110px_110px] items-center gap-3 border-b border-[#eef2df] px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-black">{leafItem.name}</p>
                    <p className="truncate text-xs font-semibold text-[#788467]">{leafItem.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-6 rounded-full border border-[#173b27]/20"
                      style={{ backgroundColor: leafItem.color || LEAF_COLORS[0] }}
                    />
                    <span className="text-xs font-bold text-[#60704a]">{leafItem.color || "default"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteLeaf(leafItem.id)}
                    disabled={busyId === leafItem.id}
                    className="ml-auto grid size-10 place-items-center rounded-md border border-[#e4b3a3] text-[#9f2f1d] transition hover:bg-[#fff2ed] disabled:opacity-50"
                    title={`Delete ${leafItem.name}`}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function arrangeLeaves(leaves, shapePoints = []) {
  return leaves.map((leafItem, index) => {
    const fallback = createTreePlacement(leafItem, index, leaves.length, "", shapePoints);
    const x = Number.isFinite(Number(leafItem.x)) ? Number(leafItem.x) : fallback.x;
    const y = Number.isFinite(Number(leafItem.y)) ? Number(leafItem.y) : fallback.y;

    return {
      ...leafItem,
      x: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxX, Math.max(LEAF_SAFE_BOUNDS.minX, x))),
      y: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxY, Math.max(LEAF_SAFE_BOUNDS.minY, y))),
      rotate: Number.isFinite(Number(leafItem.rotate)) ? Number(leafItem.rotate) : fallback.rotate,
    };
  });
}

function WishLeaf({ leaf: leafItem, isNewest }) {
  const textSize = Math.max(4.8, Math.min(8.4, 11.5 - String(leafItem.name || "").length * 0.36));

  return (
    <g transform={`translate(${leafItem.x} ${leafItem.y}) rotate(${leafItem.rotate})`}>
      <motion.g
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: isNewest ? 1.18 : 1 }}
        exit={{ opacity: 0, scale: 0 }}
        transition={{ type: "spring", stiffness: 130, damping: 16 }}
      >
        <motion.path
          d="M-5,-15 C13,-16 28,-5 32,11 C12,16 -7,13 -25,-1 C-20,-9 -13,-14 -5,-15 Z"
          fill={leafItem.color || LEAF_COLORS[0]}
          stroke="#0f5f2f"
          strokeOpacity="0.22"
          strokeWidth="2"
          animate={isNewest ? { filter: ["drop-shadow(0 0 0px #f3e572)", "drop-shadow(0 0 18px #f3e572)", "drop-shadow(0 0 0px #f3e572)"] } : {}}
          transition={{ duration: 1.8, repeat: isNewest ? 2 : 0 }}
        />
        <path d="M-18,-2 C-4,0 11,3 25,9" fill="none" stroke="#ffffff" strokeOpacity="0.34" strokeWidth="1.6" />
        <text x="3" y="5" textAnchor="middle" className="leaf-name" style={{ fontSize: textSize }}>
          {leafItem.name}
        </text>
      </motion.g>
    </g>
  );
}

function TreeSvg({ shapePoints = [], showShapeGuide = false }) {
  const canopyPath = shapePointsToPath(shapePoints);

  return (
    <g>
      <defs>
        <clipPath id={CANOPY_CLIP_ID}>
          <path d={canopyPath} />
        </clipPath>
      </defs>
      {showShapeGuide && (
        <path
          d={canopyPath}
          fill="rgba(47, 143, 70, 0.08)"
          stroke="#2f8f46"
          strokeDasharray="12 10"
          strokeWidth="4"
        />
      )}
      <ellipse cx="610" cy="710" rx="390" ry="34" fill="#29412e" opacity="0.13" />
      <path d="M522,690 C574,560 570,438 604,328 C650,444 652,560 704,690 Z" fill="#f47a28" />
      <path d="M604,328 C596,460 600,578 606,690" fill="none" stroke="#ffad5a" strokeWidth="18" strokeLinecap="round" opacity="0.42" />
      <path d="M646,365 C660,482 664,584 654,688" fill="none" stroke="#d85b1b" strokeWidth="14" strokeLinecap="round" opacity="0.28" />
    </g>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
