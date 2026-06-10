import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, RefreshCw, Search, Send, Sparkles, Trash2, Trees } from "lucide-react";
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
const DEFAULT_VISUAL_SETTINGS = {
  colorMode: "mix",
  primaryColor: "#59f1ff",
  secondaryColor: "#21c8d7",
  accentColor: "#9ffbff",
  canopySpread: 1.0,
};
const DEFAULT_APP_SETTINGS = {
  allowMultipleSubmissions: false,
  submissionsClosed: false,
  redirectToView: false,
  _loaded: false,
};
const DEFAULT_SHOW_SETTINGS = {
  raysVisible: false,
  namesVisible: false,
  rayDuration: 10,
  pulseIntensity: 1,
  namesPerBatch: 3,
  nameBatchSeconds: 1,
  revealStartedAt: 0,
};
const SUBMISSION_STORAGE_KEY = "siemens-event-submitted";

const CANOPY_CENTER = { x: 610, y: 285 };
const CANOPY_RADIUS = { x: 465, y: 255 };
const CANOPY_CLIP_ID = "wish-tree-canopy-clip";
const DEFAULT_CANOPY_PATH = "M122,334 C145,188 292,93 475,92 C522,38 697,38 746,92 C928,94 1075,188 1098,334 C1117,455 1006,539 844,516 C770,575 452,575 376,516 C214,539 103,455 122,334 Z";
const LEAF_SAFE_BOUNDS = { minX: 50, maxX: 1150, minY: 30, maxY: 600 };
const LEAF_BORDER_PADDING = 120;
const LEAF_MIN_DISTANCE = 80;
const LEAF_PLACEMENT_RETRY_MULTIPLIER = 48;

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

function hexToRgb(hex) {
  const cleanHex = String(hex || "").replace("#", "");
  const normalized = cleanHex.length === 3
    ? cleanHex.split("").map((char) => `${char}${char}`).join("")
    : cleanHex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getNodeColor(settings, leafId) {
  if (settings.colorMode === "single" || settings.colorMode === "custom") return settings.primaryColor;
  const palette = [settings.primaryColor, settings.secondaryColor, settings.accentColor].filter(Boolean);
  return palette[hashText(leafId || "node") % palette.length] || DEFAULT_VISUAL_SETTINGS.primaryColor;
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

function createTreeSlots(count, shapePoints = [], spread = 1.0) {
  const columns = Math.min(118, Math.max(44, Math.ceil(Math.sqrt(Math.max(count, 1)) * 7.2)));
  const rows = Math.max(38, Math.ceil(count / columns) + 52);
  const slots = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const normalizedX = columns === 1 ? 0 : column / (columns - 1);
      const normalizedY = rows === 1 ? 0 : row / (rows - 1);
      const x = 50 + normalizedX * 1100;
      const y = 30 + normalizedY * 570;

      if (isInsideActiveShape(x, y, shapePoints, LEAF_BORDER_PADDING, spread)) {
        slots.push({
          x,
          y,
        });
      }
    }
  }

  return slots.length ? slots : [CANOPY_CENTER];
}



function isInsideActiveShape(x, y, shapePoints = [], padding = 0, spread = 1.0) {
  if (!isInsideLeafSafeArea(x, y)) return false;
  if (shapePoints.length > 2) return isPointSafelyInPolygon({ x, y }, shapePoints, padding);
  return isInsideCanopyShape(x, y, spread);
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

function isInsideCanopyShape(x, y, spread = 1.0) {
  const s = Number(spread) || 1.0;
  const upperCrown = ((x - 610) / (540 * s)) ** 2 + ((y - 280) / (260 * s)) ** 2 <= 1;
  const leftShoulder = ((x - 360) / (300 * s)) ** 2 + ((y - 360) / (220 * s)) ** 2 <= 1;
  const rightShoulder = ((x - 860) / (300 * s)) ** 2 + ((y - 360) / (220 * s)) ** 2 <= 1;
  const lowerCenter = ((x - 610) / (320 * s)) ** 2 + ((y - 450) / (140 * s)) ** 2 <= 1;
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

function distanceToSegment(point, a, b) {
  const segmentX = b.x - a.x;
  const segmentY = b.y - a.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const rawT = lengthSquared === 0
    ? 0
    : ((point.x - a.x) * segmentX + (point.y - a.y) * segmentY) / lengthSquared;
  const t = Math.min(1, Math.max(0, rawT));
  const projection = {
    x: a.x + t * segmentX,
    y: a.y + t * segmentY,
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function distanceToPolygon(point, polygon) {
  if (polygon.length < 2) return Infinity;

  let minDistance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    minDistance = Math.min(minDistance, distanceToSegment(point, polygon[index], polygon[nextIndex]));
  }

  return minDistance;
}

function isPointSafelyInPolygon(point, polygon, padding) {
  return isPointInPolygon(point, polygon) && distanceToPolygon(point, polygon) >= padding;
}

function shapePointsToPath(points) {
  if (!points?.length) return DEFAULT_CANOPY_PATH;
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")} Z`;
}

function createTreePlacement(leafItem, index, total, salt = "", shapePoints = [], spread = 1.0) {
  const slots = createTreeSlots(total, shapePoints, spread);
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

function createPackedPlacements(leaves, salt = "", shapePoints = [], spread = 1.0) {
  const slots = createTreeSlots(leaves.length, shapePoints, spread)
    .map((slot, index) => ({
      ...slot,
      sort: hashText(`${slot.x}-${slot.y}-${salt}`) + index * 17,
    }))
    .sort((a, b) => a.sort - b.sort);
  const used = [];

  const minSquare = LEAF_MIN_DISTANCE * LEAF_MIN_DISTANCE;

  return leaves.map((leafItem, index) => {
    const preferredIndex = hashText(`${leafItem.id || leafItem.name}-${salt}`) % Math.max(slots.length, 1);
    let selected = null;

    for (let attempt = 0; attempt < slots.length; attempt += 1) {
      const slot = slots[(preferredIndex + attempt) % slots.length];
      let clear = true;
      for (let i = 0; i < used.length; i++) {
        const dx = used[i].x - slot.x;
        const dy = used[i].y - slot.y;
        if (dx * dx + dy * dy < minSquare) {
          clear = false;
          break;
        }
      }
      if (clear) {
        selected = slot;
        break;
      }
    }

    if (!selected) {
      const relaxedDistances = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
      for (const multiplier of relaxedDistances) {
        const relaxedSquare = minSquare * (multiplier * multiplier);
        for (let attempt = 0; attempt < slots.length; attempt += 1) {
          const slot = slots[(preferredIndex + attempt) % slots.length];
          let clear = true;
          for (let i = 0; i < used.length; i++) {
            const dx = used[i].x - slot.x;
            const dy = used[i].y - slot.y;
            if (dx * dx + dy * dy < relaxedSquare) {
              clear = false;
              break;
            }
          }
          if (clear) {
            selected = slot;
            break;
          }
        }
        if (selected) break;
      }
    }

    if (!selected) {
      let bestSlot = null;
      let maxNearestSquare = -1;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        let nearestSquare = Infinity;
        for (let j = 0; j < used.length; j++) {
          const dx = used[j].x - slot.x;
          const dy = used[j].y - slot.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < nearestSquare) nearestSquare = distSq;
        }
        if (nearestSquare > maxNearestSquare) {
          maxNearestSquare = nearestSquare;
          bestSlot = slot;
        }
      }
      selected = bestSlot || slots[index % slots.length] || CANOPY_CENTER;
    }

    const jitterX = ((hashText(`${leafItem.id}-x-${salt}`) % 100) - 50) * 0.14;
    const jitterY = ((hashText(`${leafItem.id}-y-${salt}`) % 100) - 50) * 0.1;
    const placement = {
      x: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxX, Math.max(LEAF_SAFE_BOUNDS.minX, selected.x + jitterX))),
      y: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxY, Math.max(LEAF_SAFE_BOUNDS.minY, selected.y + jitterY))),
      rotate: (hashText(`${leafItem.id}-${salt}`) % 70) - 35,
    };

    used.push(placement);
    return placement;
  });
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

function useVisualSettings() {
  const [visualSettings, setVisualSettings] = useState(DEFAULT_VISUAL_SETTINGS);

  useEffect(() => {
    if (!firebaseReady) return undefined;

    return onValue(ref(db, "settings/visual"), (snapshot) => {
      setVisualSettings({
        ...DEFAULT_VISUAL_SETTINGS,
        ...(snapshot.val() || {}),
      });
    });
  }, []);

  return visualSettings;
}

function useAppSettings() {
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    if (!firebaseReady) return undefined;

    return onValue(ref(db, "settings/app"), (snapshot) => {
      setAppSettings({
        ...DEFAULT_APP_SETTINGS,
        ...(snapshot.val() || {}),
        _loaded: true,
      });
    });
  }, []);

  return appSettings;
}

function useShowSettings() {
  const [showSettings, setShowSettings] = useState(DEFAULT_SHOW_SETTINGS);

  useEffect(() => {
    if (!firebaseReady) return undefined;

    return onValue(ref(db, "settings/show"), (snapshot) => {
      setShowSettings({
        ...DEFAULT_SHOW_SETTINGS,
        ...(snapshot.val() || {}),
      });
    });
  }, []);

  return showSettings;
}

function useTimedVisibleCount(total, showSettings) {
  const [now, setNow] = useState(Date.now());

  const batchSeconds = Math.max(0.1, Number(showSettings.nameBatchSeconds) || 1);
  const namesPerBatch = Math.max(1, Number(showSettings.namesPerBatch) || 1);
  const elapsedSeconds = Math.max(0, (now - Number(showSettings.revealStartedAt || 0)) / 1000);
  const batches = Math.floor(elapsedSeconds / batchSeconds) + 1;
  const currentCount = Math.min(total, batches * namesPerBatch);

  useEffect(() => {
    if (!showSettings.namesVisible || !showSettings.revealStartedAt) return undefined;
    if (currentCount >= total) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [showSettings.namesVisible, showSettings.revealStartedAt, currentCount, total]);

  if (!showSettings.namesVisible) return 0;
  if (!showSettings.revealStartedAt) return total;

  return currentCount;
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
  if (path === "/view") return <ViewPage />;
  return <SubmitPage />;
}

function SubmitPage() {
  const { leaves, status } = useLeaves();
  const appSettings = useAppSettings();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(() => localStorage.getItem(SUBMISSION_STORAGE_KEY) === "true");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (appSettings.allowMultipleSubmissions) setSent(false);
  }, [appSettings.allowMultipleSubmissions]);

  useEffect(() => {
    if (appSettings._loaded && appSettings.redirectToView) {
      window.location.pathname = "/view";
    }
  }, [appSettings.redirectToView, appSettings._loaded]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (appSettings.submissionsClosed) {
      setName("");
      localStorage.setItem(SUBMISSION_STORAGE_KEY, "true");
      setSent(true);
      return;
    }
    const cleanName = name.trim().replace(/\s+/g, " ");

    if (!appSettings.allowMultipleSubmissions && localStorage.getItem(SUBMISSION_STORAGE_KEY) === "true") {
      setSent(true);
      return;
    }
    if (!cleanName) {
      setError("Name is required.");
      return;
    }
    if (cleanName.length > 20) {
      setError("Use 20 characters or fewer.");
      return;
    }

    if (consent) {
      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone.length !== 10) {
        setError("Enter 10-digit WhatsApp number to receive certificate.");
        return;
      }
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
        phone,
        consent,
        createdAt: serverTimestamp(),
        ...placement,
      });
      setName("");
      setPhone("");
      setConsent(false);
      localStorage.setItem(SUBMISSION_STORAGE_KEY, "true");
      setSent(true);
    } catch {
      setError("Could not send your wish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="submit-shell">
        <section className="thank-you-panel">
          <div className="mx-auto mb-4 grid size-20 shrink-0 place-items-center rounded-full bg-[#009999] text-white shadow-glow">
            <Trees size={42} />
          </div>
          <h1>Thank You</h1>
          <p>Your sapling has been planted! Thank you for joining the Digital Tree Plantation.</p>
          {appSettings.allowMultipleSubmissions && (
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-6 rounded-md bg-[#00e6dc] px-5 py-3 text-sm font-black text-[#000028]"
            >
              Plant Another
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="submit-shell">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-5 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-[#009999] text-white shadow-glow">
            <Trees size={26} />
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight text-white whitespace-nowrap">The Digital Tree Plantation</h1>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-white/20 bg-white/10 p-5 shadow-glow backdrop-blur">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
              <label className="whitespace-nowrap text-xl md:text-2xl font-black text-white shrink-0" htmlFor="name">
                # I
              </label>
              <div className="flex-1 md:flex-none md:w-[260px]">
                <input
                  id="name"
                  maxLength={20}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  className="h-11 w-full rounded-md border border-white/30 bg-white px-3 text-base font-semibold text-[#000028] outline-none transition focus:border-[#00e6dc] focus:ring-4 focus:ring-[#00e6dc]/25"
                  placeholder="Enter name"
                  autoComplete="name"
                />
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm md:text-base font-semibold text-white leading-snug">
                Plant my name in this digital forest as a promise to protect our real one.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError("");
              }}
              className="h-11 w-full md:w-[320px] rounded-md border border-white/30 bg-white px-3 text-base font-semibold text-[#000028] outline-none transition focus:border-[#00e6dc] focus:ring-4 focus:ring-[#00e6dc]/25"
              placeholder="Enter WhatsApp number"
            />
            <label className="flex items-start gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 size-4 shrink-0 rounded border-white/30 accent-[#009999]"
              />
              <span className="leading-tight">
                I consent to receive the Tree Plantation Digital Certificate via Email and WhatsApp at the number provided below.
              </span>
            </label>
            {error && <span className="mt-1 block text-xs font-semibold text-[#ff9898]">{error}</span>}
          </div>
          <button
            className="mt-6 flex h-12 w-full md:w-auto md:min-w-[200px] items-center justify-center gap-2 rounded-md bg-[#009999] px-6 text-base font-black text-white transition hover:bg-white hover:text-[#009999] disabled:cursor-not-allowed disabled:opacity-60 md:ml-auto"
            type="submit"
            disabled={busy}
          >
            <Send size={19} />
            {busy ? "Sending" : "Add My Tree"}
          </button>
        </form>

        <AnimatePresence>
          {sent && appSettings.allowMultipleSubmissions && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="mt-5 flex items-center gap-2 rounded-md bg-white/12 px-4 py-3 text-sm font-bold text-white"
            >
              <Sparkles size={17} />
              Your sapling has been planted! Thank you for joining the Digital Tree Plantation.
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
  const visualSettings = useVisualSettings();
  const showSettings = useShowSettings();
  const previousIds = useRef(new Set());
  const [newestId, setNewestId] = useState(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draggedLeafId, setDraggedLeafId] = useState("");
  const [draggedLeafPosition, setDraggedLeafPosition] = useState(null);

  const activeShape = draftPoints.length > 2 ? draftPoints : shapePoints;
  const visibleCount = useTimedVisibleCount(leaves.length, showSettings);

  const visibleLeaves = useMemo(
    () => showSettings.namesVisible ? leaves.slice(0, visibleCount) : [],
    [showSettings.namesVisible, leaves, visibleCount]
  );

  const arrangedLeaves = useMemo(() => {
    const arranged = arrangeLeaves(visibleLeaves, shapePoints, visualSettings.canopySpread);
    if (!draggedLeafId || !draggedLeafPosition) return arranged;
    return arranged.map((leafItem) => (
      leafItem.id === draggedLeafId
        ? { ...leafItem, x: draggedLeafPosition.x, y: draggedLeafPosition.y }
        : leafItem
    ));
  }, [draggedLeafId, draggedLeafPosition, visibleLeaves, shapePoints, visualSettings.canopySpread]);
  const rayLeaves = useMemo(() => arrangeLeaves(leaves, shapePoints, visualSettings.canopySpread), [leaves, shapePoints, visualSettings.canopySpread]);
  const newestLeaf = arrangedLeaves.find((leafItem) => leafItem.id === newestId) || arrangedLeaves.at(-1);

  useEffect(() => {
    const currentIds = new Set(leaves.map((leafItem) => leafItem.id));
    const added = leaves.find((leafItem) => !previousIds.current.has(leafItem.id));
    if (added && previousIds.current.size) setNewestId(added.id);
    previousIds.current = currentIds;
  }, [leaves]);

  async function rearrangeFromDisplay() {
    if (!firebaseReady || !leaves.length) return;
    const updates = {};
    const placements = createPackedPlacements(leaves, String(Date.now()), shapePoints, visualSettings.canopySpread);

    leaves.forEach((leafItem, index) => {
      const placement = placements[index];
      updates[`leaves/${leafItem.id}/x`] = placement.x;
      updates[`leaves/${leafItem.id}/y`] = placement.y;
      updates[`leaves/${leafItem.id}/rotate`] = placement.rotate;
    });

    await update(ref(db), updates);
  }

  useEffect(() => {
    async function handleKeyDown(event) {
      if (event.key === "1") {
        event.preventDefault();
        await rearrangeFromDisplay();
        return;
      }

      if (event.key === "5") {
        setDrawingMode((current) => !current);
        setDraftPoints([]);
        setIsDrawing(false);
        setDraggedLeafId("");
        setDraggedLeafPosition(null);
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
  }, [drawingMode, draftPoints, leaves, shapePoints]);

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
    if (draggedLeafId) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = getSvgPoint(event);
    setDraftPoints([point]);
    setIsDrawing(true);
  }

  function drawPoint(event) {
    if (drawingMode && draggedLeafId) {
      event.preventDefault();
      setDraggedLeafPosition(getSvgPoint(event));
      return;
    }

    if (!drawingMode || !isDrawing) return;
    event.preventDefault();
    const point = getSvgPoint(event);
    setDraftPoints((points) => {
      const last = points.at(-1);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 8) return points;
      return [...points, point];
    });
  }

  async function finishDrawing() {
    if (drawingMode && draggedLeafId && draggedLeafPosition && firebaseReady) {
      await update(ref(db, `leaves/${draggedLeafId}`), {
        x: draggedLeafPosition.x,
        y: draggedLeafPosition.y,
      });
      setDraggedLeafId("");
      setDraggedLeafPosition(null);
      return;
    }

    if (!drawingMode || !isDrawing) return;
    setIsDrawing(false);

    if (draftPoints.length > 8 && firebaseReady) {
      await set(ref(db, "settings/canopyShape"), draftPoints);
    }
  }

  function startLeafDrag(event, leafItem) {
    if (!drawingMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDrawing(false);
    setDraggedLeafId(leafItem.id);
    setDraggedLeafPosition({ x: leafItem.x, y: leafItem.y });
  }

  return (
    <main className="display-shell">
      <div className="display-hud">
        <div>
          <h1 className="text-4xl font-black leading-none">{leaves.length} trees</h1>
        </div>
        <div className="newest-leaf">
          <Leaf size={18} />
          <span>{newestLeaf?.name || (status === "connected" ? "Waiting for wishes" : "Connecting")}</span>
        </div>
      </div>

      {drawingMode && (
        <div className="draw-shape-hint">
          Draw shape or drag leaves. Press 1 to rearrange. Press 5 to exit.
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
        <DigitalTreeSvg
          nodes={rayLeaves}
          shapePoints={activeShape}
          showShapeGuide={drawingMode}
          visualSettings={visualSettings}
          showRays={showSettings.raysVisible}
          rayDuration={Number(showSettings.rayDuration) || 10}
          pulseIntensity={Number(showSettings.pulseIntensity) ?? 1}
        />
        <AnimatePresence>
          {arrangedLeaves.map((leafItem) => (
            <WishLeaf
              key={leafItem.id}
              leaf={leafItem}
              isNewest={leafItem.id === newestId}
              canDrag={drawingMode}
              visualSettings={visualSettings}
              onPointerDown={(event) => startLeafDrag(event, leafItem)}
            />
          ))}
        </AnimatePresence>
      </svg>
    </main>
  );
}

function ViewPage() {
  const { leaves, status } = useLeaves();
  const shapePoints = useCanopyShape();
  const visualSettings = useVisualSettings();
  const showSettings = useShowSettings();
  const appSettings = useAppSettings();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (appSettings._loaded && !appSettings.redirectToView) {
      window.location.pathname = "/";
    }
  }, [appSettings.redirectToView, appSettings._loaded]);
  const [highlightedId, setHighlightedId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  const CLOUDINARY_CLOUD = "derb7wswl";
  const CLOUDINARY_FOLDER = "trees123";

  const arrangedLeaves = useMemo(() => arrangeLeaves(leaves, shapePoints, visualSettings.canopySpread), [leaves, shapePoints, visualSettings.canopySpread]);
  const rayLeaves = arrangedLeaves;

  const CENTER_TARGET = { x: 610, y: 400 };

  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/[\s.,@_]+/g, '');
    if (!q) return [];
    return arrangedLeaves.filter((l) => {
      const cleanName = l.name?.toLowerCase().replace(/[\s.,@_]+/g, '') || "";
      return cleanName.includes(q);
    }).slice(0, 8);
  }, [searchQuery, arrangedLeaves]);

  function selectLeaf(leafItem) {
    setHighlightedId(leafItem.id);
    setSearchQuery(leafItem.name);
    setShowSuggestions(false);
  }

  function clearSearch() {
    setHighlightedId(null);
    setSearchQuery("");
    setShowSuggestions(false);
  }

  function openLeafImage(leafItem) {
    if (!leafItem || leafItem.id !== highlightedId) return;
    const encodedName = encodeURIComponent(leafItem.name.replace(/[\s.,@_]+/g, '').toLowerCase());
    const url = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/${encodedName}`;
    setImageUrl(url);
  }

  function closeImage() {
    setImageUrl(null);
  }

  const displayLeaves = useMemo(() => {
    if (!highlightedId) return arrangedLeaves;
    return arrangedLeaves.map((l) =>
      l.id === highlightedId
        ? { ...l, x: CENTER_TARGET.x, y: CENTER_TARGET.y, rotate: 0 }
        : l
    );
  }, [highlightedId, arrangedLeaves]);

  return (
    <main className="display-shell">
      <div className="display-hud">
        <div>
          <h1 className="text-4xl font-black leading-none">{leaves.length} trees</h1>
        </div>
        <div className="view-search-wrapper">
          <div className="view-search-bar">
            <Search size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); setHighlightedId(null); }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search name..."
              className="view-search-input"
            />
            {highlightedId && (
              <button type="button" onClick={clearSearch} className="view-search-btn" style={{ background: "rgba(255,255,255,0.15)" }}>✕</button>
            )}
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="view-suggestions">
              {suggestions.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="view-suggestion-item"
                  onClick={() => selectLeaf(l)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <svg
        className="tree-stage"
        viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`}
        role="img"
        aria-label="Digital wish tree"
      >
        <DigitalTreeSvg
          nodes={rayLeaves}
          shapePoints={shapePoints}
          visualSettings={visualSettings}
          showRays={showSettings.raysVisible}
          rayDuration={Number(showSettings.rayDuration) || 10}
          pulseIntensity={Number(showSettings.pulseIntensity) ?? 1}
        />
        {displayLeaves.map((leafItem) => (
          <ViewLeaf
            key={leafItem.id}
            leaf={leafItem}
            isHighlighted={leafItem.id === highlightedId}
            visualSettings={visualSettings}
            onLeafClick={() => openLeafImage(leafItem)}
          />
        ))}
        {highlightedId && (
          <motion.circle
            cx={CENTER_TARGET.x}
            cy={CENTER_TARGET.y}
            fill="none"
            stroke={visualSettings.primaryColor}
            strokeWidth="3"
            initial={{ opacity: 0, r: 20 }}
            animate={{ opacity: [0.8, 0.3, 0.8], r: [30, 55, 30] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </svg>

      {imageLoading && (
        <div className="image-overlay">
          <div className="image-overlay-loading">Loading...</div>
        </div>
      )}

      <AnimatePresence>
        {imageUrl && (
          <motion.div
            className="image-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeImage}
          >
            <motion.img
              src={imageUrl}
              alt={searchQuery}
              className="image-overlay-img"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
            />
            <a
              href={imageUrl.replace("/image/upload/", "/image/upload/fl_attachment/")}
              download
              onClick={(e) => e.stopPropagation()}
              className="image-overlay-download"
            >
              Save Image
            </a>
            <button type="button" className="image-overlay-close" onClick={closeImage}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

const ViewLeaf = React.memo(function ViewLeaf({ leaf: leafItem, isHighlighted, visualSettings = DEFAULT_VISUAL_SETTINGS, onLeafClick }) {
  const name = String(leafItem.name || "");
  const textSize = Math.max(5.2, Math.min(9.2, 11.8 - name.length * 0.32));
  const nodeColor = getNodeColor(visualSettings, leafItem.id);

  return (
    <motion.g
      animate={{
        x: leafItem.x,
        y: leafItem.y,
        rotate: leafItem.rotate || 0,
        scale: isHighlighted ? 1.5 : 1,
      }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      onClick={isHighlighted ? onLeafClick : undefined}
      style={{ cursor: isHighlighted ? "pointer" : "default" }}
    >
      <path
        d="M-6,-18 C17,-18 36,-4 42,16 C18,22 -9,18 -34,-3 C-27,-12 -18,-17 -6,-18 Z"
        fill={rgba(nodeColor, 0.3)}
        stroke={nodeColor}
        strokeWidth="2.4"
      />
      {isHighlighted && (
        <motion.path
          d="M-6,-18 C17,-18 36,-4 42,16 C18,22 -9,18 -34,-3 C-27,-12 -18,-17 -6,-18 Z"
          fill="none"
          stroke={nodeColor}
          strokeWidth="3.6"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: [0.7, 0], scale: [1, 1.34] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <path d="M-25,-3 C-8,0 13,3 32,11" fill="none" stroke={visualSettings.accentColor} strokeOpacity="0.46" strokeWidth="1.7" />
      <text x="4" y="4" textAnchor="middle" className="leaf-name node-name" style={{ fontSize: isHighlighted ? textSize * 1.1 : textSize }}>
        {name}
      </text>
    </motion.g>
  );
});


function AdminPage() {
  const { leaves, status } = useLeaves();
  const shapePoints = useCanopyShape();
  const visualSettings = useVisualSettings();
  const appSettings = useAppSettings();
  const showSettings = useShowSettings();
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [draftVisualSettings, setDraftVisualSettings] = useState(DEFAULT_VISUAL_SETTINGS);
  const [draftAppSettings, setDraftAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [draftShowSettings, setDraftShowSettings] = useState(DEFAULT_SHOW_SETTINGS);
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem("admin_auth") === "true");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setDraftVisualSettings(visualSettings);
  }, [visualSettings]);

  useEffect(() => {
    setDraftAppSettings(appSettings);
  }, [appSettings]);

  useEffect(() => {
    setDraftShowSettings(showSettings);
  }, [showSettings]);

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f0e6] px-5 text-[#173b27]">
        <section className="w-full max-w-sm rounded-lg border border-[#d6c8a7] bg-white p-6 shadow-glow text-center">
          <h1 className="text-2xl font-black mb-4">Admin Access</h1>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (password === "360brightmedia") {
              setAuthenticated(true);
              localStorage.setItem("admin_auth", "true");
            } else {
              alert("Incorrect password");
            }
          }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[#c6d49f] p-3 mb-4 bg-[#f8fbf3] outline-none font-bold"
              placeholder="Enter password"
              autoFocus
            />
            <button className="admin-button w-full bg-[#173b27] text-white hover:bg-[#22583a]">
              Login
            </button>
          </form>
        </section>
      </main>
    );
  }

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

  async function resetShape() {
    if (!firebaseReady || !window.confirm("Reset shape to default?")) return;
    setBusyId("reset-shape");
    setMessage("");

    try {
      await remove(ref(db, "settings/canopyShape"));
      setMessage("Shape reset to default.");
    } catch {
      setMessage("Could not reset shape. Check database rules.");
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
      const placements = createPackedPlacements(leaves, salt, shapePoints, visualSettings.canopySpread);
      leaves.forEach((leafItem, index) => {
        const placement = placements[index];
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

  async function saveVisualSettings() {
    if (!firebaseReady) return;
    setBusyId("visual");
    setMessage("");

    try {
      await set(ref(db, "settings/visual"), draftVisualSettings);
      setMessage("Glow colors updated.");
    } catch {
      setMessage("Could not update colors. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function saveAppSettings() {
    if (!firebaseReady) return;
    setBusyId("app-settings");
    setMessage("");

    try {
      await set(ref(db, "settings/app"), draftAppSettings);
      setMessage("Submission settings updated.");
    } catch {
      setMessage("Could not update submission settings. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function saveShowSettings(nextSettings) {
    if (!firebaseReady) return;
    setBusyId("show-settings");
    setMessage("");

    try {
      await set(ref(db, "settings/show"), nextSettings);
      setMessage("Display show controls updated.");
    } catch {
      setMessage("Could not update show controls. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function growRays() {
    await saveShowSettings({
      ...draftShowSettings,
      raysVisible: true,
      namesVisible: false,
      revealStartedAt: 0,
    });
  }

  async function showNames() {
    if (!firebaseReady) return;
    setBusyId("show-settings");
    setMessage("");

    try {
      const updates = {};
      const salt = String(Date.now());
      const placements = createPackedPlacements(leaves, salt, shapePoints, visualSettings.canopySpread);
      leaves.forEach((leafItem, index) => {
        const placement = placements[index];
        updates[`leaves/${leafItem.id}/x`] = placement.x;
        updates[`leaves/${leafItem.id}/y`] = placement.y;
        updates[`leaves/${leafItem.id}/rotate`] = placement.rotate;
      });
      updates["settings/show"] = {
        ...draftShowSettings,
        raysVisible: true,
        namesVisible: true,
        revealStartedAt: Date.now(),
      };
      await update(ref(db), updates);
      setMessage("Names reveal started.");
    } catch {
      setMessage("Could not start name reveal. Check database rules.");
    } finally {
      setBusyId("");
    }
  }

  async function resetDisplayShow() {
    await saveShowSettings({
      ...draftShowSettings,
      raysVisible: false,
      namesVisible: false,
      revealStartedAt: 0,
    });
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
            <button
              type="button"
              onClick={resetShape}
              disabled={busyId === "reset-shape"}
              className="admin-button border border-[#3a8dc7] bg-white text-[#1d599f] hover:bg-[#edf5ff]"
            >
              <RefreshCw size={18} />
              Reset Shape
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-md border border-[#c6d49f] bg-white px-4 py-3 text-sm font-bold">
            {message}
          </div>
        )}

        <div className="mb-5 rounded-lg border border-[#c6d49f] bg-white p-4 shadow-glow">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Glow Colors</h2>
              <p className="text-sm font-bold text-[#60704a]">Use one color or mix three colors across leaves and branches.</p>
            </div>
            <button
              type="button"
              onClick={saveVisualSettings}
              disabled={busyId === "visual"}
              className="admin-button bg-[#173b27] text-white hover:bg-[#22583a]"
            >
              {busyId === "visual" ? "Saving" : "Save Colors"}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[220px_1fr_1fr_1fr]">
            <label className="admin-field">
              <span>Spread Extent: {draftVisualSettings.canopySpread ?? 1.0}</span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={draftVisualSettings.canopySpread ?? 1.0}
                onChange={(event) => setDraftVisualSettings((settings) => ({ ...settings, canopySpread: parseFloat(event.target.value) }))}
              />
            </label>
            <label className="admin-field">
              <span>Mode</span>
              <select
                value={draftVisualSettings.colorMode}
                onChange={(event) => setDraftVisualSettings((settings) => ({ ...settings, colorMode: event.target.value }))}
              >
                <option value="mix">Mixed colors</option>
                <option value="single">Single color</option>
                <option value="custom">Custom roles</option>
              </select>
            </label>
            {[
              ["primaryColor", draftVisualSettings.colorMode === "custom" ? "Leaves Color" : "Primary"],
              ["secondaryColor", draftVisualSettings.colorMode === "custom" ? "Rays Color" : "Secondary"],
              ["accentColor", draftVisualSettings.colorMode === "custom" ? "Trunk Base" : "Accent"],
            ].map(([key, label]) => (
              <label key={key} className="admin-field">
                <span>{label}</span>
                <div className="color-input-row">
                  <input
                    type="color"
                    value={draftVisualSettings[key]}
                    onChange={(event) => setDraftVisualSettings((settings) => ({ ...settings, [key]: event.target.value }))}
                  />
                  <input
                    value={draftVisualSettings[key]}
                    onChange={(event) => setDraftVisualSettings((settings) => ({ ...settings, [key]: event.target.value }))}
                    maxLength={7}
                  />
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-[#c6d49f] bg-white p-4 shadow-glow">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Display Show Controls</h2>
              <p className="text-sm font-bold text-[#60704a]">Start with an empty display, grow rays, then reveal names in batches.</p>
            </div>
            <button
              type="button"
              onClick={() => saveShowSettings(draftShowSettings)}
              disabled={busyId === "show-settings"}
              className="admin-button bg-[#173b27] text-white hover:bg-[#22583a]"
            >
              Save Timing
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="admin-field">
              <span>Ray grow duration seconds</span>
              <input
                type="number"
                min="1"
                value={draftShowSettings.rayDuration}
                onChange={(event) => setDraftShowSettings((settings) => ({ ...settings, rayDuration: Number(event.target.value) }))}
              />
            </label>
            <label className="admin-field">
              <span>Pulse Intensity (0-5)</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={draftShowSettings.pulseIntensity ?? 1}
                onChange={(event) => setDraftShowSettings((settings) => ({ ...settings, pulseIntensity: Number(event.target.value) }))}
              />
            </label>
            <label className="admin-field">
              <span>Names per batch</span>
              <input
                type="number"
                min="1"
                value={draftShowSettings.namesPerBatch}
                onChange={(event) => setDraftShowSettings((settings) => ({ ...settings, namesPerBatch: Number(event.target.value) }))}
              />
            </label>
            <label className="admin-field">
              <span>Batch interval seconds</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={draftShowSettings.nameBatchSeconds}
                onChange={(event) => setDraftShowSettings((settings) => ({ ...settings, nameBatchSeconds: Number(event.target.value) }))}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={resetDisplayShow} className="admin-button border border-[#c6d49f] bg-white text-[#173b27] hover:bg-[#f8fbf3]">
              Reset Empty
            </button>
            <button type="button" onClick={growRays} className="admin-button bg-[#173b27] text-white hover:bg-[#22583a]">
              Grow Tree Rays
            </button>
            <button type="button" onClick={showNames} className="admin-button bg-[#00a99d] text-white hover:bg-[#008f85]">
              Show Names
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-[#c6d49f] bg-white p-4 shadow-glow">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Submission Control</h2>
              <p className="text-sm font-bold text-[#60704a]">Choose whether one phone can submit once or multiple times.</p>
            </div>
            <button
              type="button"
              onClick={saveAppSettings}
              disabled={busyId === "app-settings"}
              className="admin-button bg-[#173b27] text-white hover:bg-[#22583a]"
            >
              {busyId === "app-settings" ? "Saving" : "Save Settings"}
            </button>
          </div>
          <label className="flex items-center gap-3 text-sm font-black">
            <input
              type="checkbox"
              checked={draftAppSettings.allowMultipleSubmissions}
              onChange={(event) => setDraftAppSettings((settings) => ({
                ...settings,
                allowMultipleSubmissions: event.target.checked,
              }))}
              className="size-5"
            />
            Allow multiple submissions from same phone
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm font-black text-[#e04545]">
            <input
              type="checkbox"
              checked={draftAppSettings.submissionsClosed}
              onChange={(event) => setDraftAppSettings((settings) => ({
                ...settings,
                submissionsClosed: event.target.checked,
              }))}
              className="size-5"
            />
            Stop taking responses
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm font-black text-[#59f1ff]">
            <input
              type="checkbox"
              checked={draftAppSettings.redirectToView}
              onChange={(event) => setDraftAppSettings((settings) => ({
                ...settings,
                redirectToView: event.target.checked,
              }))}
              className="size-5"
            />
            Force Submit Page to View Page
          </label>
        </div>

        <div className="mb-5 overflow-hidden rounded-lg border border-[#c6d49f] bg-white shadow-glow">
          <div className="px-4 py-3 border-b border-[#dbe4c5] bg-[#f8fbf3]">
            <h2 className="text-xl font-black">Participants Dashboard (Read-only)</h2>
          </div>
          <div className="grid grid-cols-[1fr_1fr_100px] gap-3 border-b border-[#dbe4c5] bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-[#60704a]">
            <span>Name</span>
            <span>WhatsApp Number</span>
            <span>Consent</span>
          </div>
          <div className="max-h-[40vh] overflow-auto">
            {leaves.map((leafItem) => (
              <div
                key={leafItem.id}
                className="grid grid-cols-[1fr_1fr_100px] items-center gap-3 border-b border-[#eef2df] px-4 py-3 last:border-b-0"
              >
                <div className="truncate text-base font-black">{leafItem.name}</div>
                <div className="truncate text-sm font-semibold text-[#173b27]">{leafItem.phone || "—"}</div>
                <div className="truncate text-sm font-semibold text-[#173b27]">{leafItem.consent ? "Yes" : "No"}</div>
              </div>
            ))}
            {leaves.length === 0 && (
              <div className="px-4 py-8 text-center text-sm font-bold text-[#60704a]">No responses yet.</div>
            )}
          </div>
        </div>

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

function arrangeLeaves(leaves, shapePoints = [], spread = 1.0) {
  const fallbackPlacements = createPackedPlacements(leaves, "display-fallback", shapePoints, spread);

  return leaves.map((leafItem, index) => {
    const fallback = fallbackPlacements[index] || createTreePlacement(leafItem, index, leaves.length, "", shapePoints, spread);
    const savedX = Number(leafItem.x);
    const savedY = Number(leafItem.y);
    const savedPositionIsUsable = Number.isFinite(savedX)
      && Number.isFinite(savedY)
      && isInsideActiveShape(savedX, savedY, shapePoints, LEAF_BORDER_PADDING, spread);
    const x = savedPositionIsUsable ? savedX : fallback.x;
    const y = savedPositionIsUsable ? savedY : fallback.y;

    return {
      ...leafItem,
      x: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxX, Math.max(LEAF_SAFE_BOUNDS.minX, x))),
      y: Math.round(Math.min(LEAF_SAFE_BOUNDS.maxY, Math.max(LEAF_SAFE_BOUNDS.minY, y))),
      rotate: Number.isFinite(Number(leafItem.rotate)) ? Number(leafItem.rotate) : fallback.rotate,
    };
  });
}

const WishLeaf = React.memo(function WishLeaf({ leaf: leafItem, isNewest, canDrag = false, visualSettings = DEFAULT_VISUAL_SETTINGS, onPointerDown }) {
  const name = String(leafItem.name || "");
  const textSize = Math.max(5.2, Math.min(9.2, 11.8 - name.length * 0.32));
  const nodeColor = getNodeColor(visualSettings, leafItem.id);
  const fallSeed = hashText(`${leafItem.id || name}-fall`);
  const fallDuration = 3.4 + (fallSeed % 11) * 0.18;
  const fallDelay = (fallSeed % 8) * 0.04;

  const { swayX, fallRotate, fallTimes, startY } = useMemo(() => {
    const windDirection = fallSeed % 2 === 0 ? 1 : -1;
    const startDrift = windDirection * (120 + (fallSeed % 180));
    const startYValue = -TREE_HEIGHT - (fallSeed % 160);
    const swings = 1.5 + ((fallSeed % 10) * 0.1);
    const amplitude = 60 + (fallSeed % 50);
    const steps = 20;

    const xArr = [];
    const rotArr = [];
    const tArr = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      tArr.push(t);

      if (i === steps) {
        xArr.push(0);
        rotArr.push(0);
      } else {
        const taper = 1 - t;
        const sineValue = Math.sin(t * Math.PI * 2 * swings);
        const gust = i === 0 ? 0 : ((hashText(`${leafItem.id}-g-${i}`) % 30) - 15);

        xArr.push((startDrift * taper) + (sineValue * amplitude) + gust);
        rotArr.push(Math.cos(t * Math.PI * 2 * swings) * (amplitude * 0.6) + gust * 1.5);
      }
    }

    return { swayX: xArr, fallRotate: rotArr, fallTimes: tArr, startY: startYValue };
  }, [leafItem.id, fallSeed]);

  return (
    <g
      transform={`translate(${leafItem.x} ${leafItem.y}) rotate(${leafItem.rotate || 0})`}
      onPointerDown={onPointerDown}
      style={{ cursor: canDrag ? "grab" : "default" }}
    >
      <motion.g
        initial={{ opacity: 0, scale: 0.72, x: swayX[0], y: startY, rotate: fallRotate[0] }}
        animate={{
          opacity: 1,
          scale: isNewest ? 1.18 : 1,
          x: swayX,
          y: [startY, 0],
          rotate: fallRotate,
        }}
        exit={{ opacity: 0, scale: 0 }}
        transition={{
          opacity: { duration: 0.5, delay: fallDelay },
          scale: { duration: fallDuration, delay: fallDelay, ease: "easeOut" },
          x: { duration: fallDuration, delay: fallDelay, ease: "linear", times: fallTimes },
          y: { duration: fallDuration, delay: fallDelay, ease: "easeIn" },
          rotate: { duration: fallDuration, delay: fallDelay, ease: "linear", times: fallTimes },
        }}
      >
        <path
          d="M-6,-18 C17,-18 36,-4 42,16 C18,22 -9,18 -34,-3 C-27,-12 -18,-17 -6,-18 Z"
          fill={rgba(nodeColor, 0.3)}
          stroke={nodeColor}
          strokeWidth="2.4"
        />
        {isNewest && (
          <motion.path
            d="M-6,-18 C17,-18 36,-4 42,16 C18,22 -9,18 -34,-3 C-27,-12 -18,-17 -6,-18 Z"
            fill="none"
            stroke={nodeColor}
            strokeWidth="3.6"
            initial={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: [0.7, 0], scale: [1, 1.34] }}
            transition={{ duration: 1.4, repeat: 1, ease: "easeOut" }}
          />
        )}
        <path d="M-25,-3 C-8,0 13,3 32,11" fill="none" stroke={visualSettings.accentColor} strokeOpacity="0.46" strokeWidth="1.7" />
        <text x="4" y="4" textAnchor="middle" className="leaf-name node-name" style={{ fontSize: textSize }}>
          {name}
        </text>
      </motion.g>
    </g>
  );
}, (prev, next) => prev.leaf.id === next.leaf.id && prev.leaf.x === next.leaf.x && prev.leaf.y === next.leaf.y && prev.isNewest === next.isNewest && prev.canDrag === next.canDrag);

const DigitalTreeSvg = React.memo(function DigitalTreeSvg({ nodes = [], shapePoints = [], showShapeGuide = false, visualSettings = DEFAULT_VISUAL_SETTINGS, showRays = true, rayDuration = 10, pulseIntensity = 1 }) {
  const canopyPath = shapePointsToPath(shapePoints);
  const root = { x: 604, y: 700 };
  const neck = { x: 605, y: 450 };
  const primary = visualSettings.primaryColor;
  const secondary = visualSettings.secondaryColor;
  const accent = visualSettings.accentColor;

  return (
    <g>
      <defs>
        <radialGradient id="digital-bg-glow" cx="50%" cy="35%" r="62%">
          <stop offset="0%" stopColor={secondary} stopOpacity="0.36" />
          <stop offset="45%" stopColor="#083b49" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#04171e" stopOpacity="1" />
        </radialGradient>
        <filter id="cyan-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={CANOPY_CLIP_ID}>
          <path d={canopyPath} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width={TREE_WIDTH} height={TREE_HEIGHT} fill="#000028" />
      <g opacity="0.18">
        {Array.from({ length: 90 }).map((_, index) => {
          const x = (hashText(`star-x-${index}`) % TREE_WIDTH);
          const y = (hashText(`star-y-${index}`) % 480) + 40;
          return <circle key={index} cx={x} cy={y} r={(index % 3) + 0.8} fill={accent} />;
        })}
      </g>
      {showShapeGuide && (
        <path
          d={canopyPath}
          fill={rgba(primary, 0.06)}
          stroke={primary}
          strokeDasharray="12 10"
          strokeWidth="4"
        />
      )}
      <ellipse cx="610" cy="720" rx="260" ry="20" fill={primary} opacity={showRays ? 0.08 : 0} />
      <g filter="url(#cyan-glow)">
        {[
          { d: "M582,708 C566,604 578,520 602,440 C626,520 634,604 626,708", stroke: visualSettings.colorMode === "custom" ? accent : primary, width: 3.2, opacity: 0.82 },
          { d: "M604,708 C594,612 598,526 606,438 C617,526 622,612 616,708", stroke: accent, width: 2.2, opacity: 0.95 },
          { d: "M628,708 C662,602 646,520 610,438", stroke: visualSettings.colorMode === "custom" ? accent : secondary, width: 2.2, opacity: 0.74 },
        ].map((line) => {
          const minOp = Math.max(0, line.opacity * (1 - 0.5 * pulseIntensity));
          const maxOp = Math.min(1, line.opacity * (1 + (pulseIntensity - 1) * 0.5));
          return (
            <motion.path
              key={line.d}
              d={line.d}
              fill="none"
              stroke={line.stroke}
              strokeWidth={line.width}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{
                pathLength: showRays ? 1 : 0,
                opacity: showRays ? [minOp, maxOp, minOp] : 0
              }}
              transition={{
                pathLength: { duration: rayDuration, ease: "easeInOut" },
                opacity: showRays ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.5 }
              }}
            />
          )
        })}
      </g>
      <g>
        {nodes.map((node, index) => {
          const sidePull = node.x < neck.x ? -80 : 80;
          const midY = Math.min(500, Math.max(245, node.y + 120));
          const path = `M${root.x},${root.y} C${root.x + sidePull * 0.25},${610 - index % 80} ${neck.x + sidePull},${midY} ${node.x},${node.y}`;
          const lineColor = visualSettings.colorMode === "custom" ? secondary : getNodeColor(visualSettings, node.id);
          const baseOp = 0.5;
          const minNode = Math.max(0, baseOp - 0.2 * pulseIntensity);
          const maxNode = Math.min(1, baseOp + 0.2 * pulseIntensity);
          return (
            <motion.path
              key={`${node.id}-line`}
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth={index % 5 === 0 ? 2.2 : 1.35}
              strokeOpacity="0.56"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{
                pathLength: showRays ? 1 : 0,
                opacity: showRays ? [minNode, maxNode, minNode] : 0
              }}
              transition={{
                pathLength: { duration: rayDuration, delay: Math.min(index * 0.01, 0.7), ease: "easeInOut" },
                opacity: showRays ? { duration: 3, delay: Math.min(index * 0.01, 0.7), repeat: Infinity, ease: "easeInOut" } : { duration: 0.5 }
              }}
            />
          );
        })}
      </g>
    </g>
  );
});

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
