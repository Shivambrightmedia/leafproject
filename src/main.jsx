import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import { Leaf, Send, Sparkles, Trees } from "lucide-react";
import {
  onValue,
  push,
  ref,
  serverTimestamp,
  set,
} from "firebase/database";
import { db, firebaseReady } from "./services/firebase";
import "./styles.css";

const LEAF_COLORS = ["#2f8f46", "#74b84f", "#a7c957"];
const TREE_WIDTH = 1200;
const TREE_HEIGHT = 760;

const branchAnchors = [
  { x: 300, y: 330 }, { x: 365, y: 280 }, { x: 430, y: 230 },
  { x: 505, y: 190 }, { x: 585, y: 170 }, { x: 665, y: 185 },
  { x: 745, y: 225 }, { x: 815, y: 275 }, { x: 880, y: 330 },
  { x: 390, y: 385 }, { x: 500, y: 335 }, { x: 620, y: 315 },
  { x: 740, y: 350 }, { x: 830, y: 410 }, { x: 275, y: 435 },
  { x: 445, y: 455 }, { x: 610, y: 430 }, { x: 775, y: 470 },
  { x: 920, y: 470 }, { x: 545, y: 250 }, { x: 675, y: 255 },
];

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
  const anchor = branchAnchors[Math.floor(random() * branchAnchors.length)];
  const radius = 18 + random() * 60;
  const angle = random() * Math.PI * 2;

  return {
    x: Math.round(Math.min(1010, Math.max(190, anchor.x + Math.cos(angle) * radius))),
    y: Math.round(Math.min(520, Math.max(105, anchor.y + Math.sin(angle) * radius * 0.72))),
    color: LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)],
  };
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
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5d6e35]">
              Live Event
            </p>
            <h1 className="text-3xl font-black leading-tight">Digital Tree of Wishes</h1>
          </div>
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
            <span>{error || (status === "connected" ? "Ready to grow a leaf." : "Connecting...")}</span>
            <span>{name.trim().length}/20</span>
          </div>
          <button
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[#173b27] px-5 text-base font-black text-white transition hover:bg-[#22583a] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            <Send size={19} />
            {busy ? "Sending" : "Add My Leaf"}
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
              Your leaf is now on the tree.
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}

function DisplayPage() {
  const { leaves, status } = useLeaves();
  const previousIds = useRef(new Set());
  const [newestId, setNewestId] = useState(null);

  const arrangedLeaves = useMemo(() => arrangeLeaves(leaves), [leaves]);
  const newestLeaf = arrangedLeaves.find((leafItem) => leafItem.id === newestId) || arrangedLeaves.at(-1);

  useEffect(() => {
    const currentIds = new Set(leaves.map((leafItem) => leafItem.id));
    const added = leaves.find((leafItem) => !previousIds.current.has(leafItem.id));
    if (added && previousIds.current.size) setNewestId(added.id);
    previousIds.current = currentIds;
  }, [leaves]);

  return (
    <main className="display-shell">
      <div className="display-hud">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-[#77834c]">Digital Tree of Wishes</p>
          <h1 className="text-4xl font-black leading-none text-[#173b27]">{leaves.length} leaves</h1>
        </div>
        <div className="newest-leaf">
          <Leaf size={18} />
          <span>{newestLeaf?.name || (status === "connected" ? "Waiting for wishes" : "Connecting")}</span>
        </div>
      </div>

      <svg className="tree-stage" viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`} role="img" aria-label="Digital wish tree">
        <TreeSvg />
        <AnimatePresence>
          {arrangedLeaves.map((leafItem) => (
            <WishLeaf key={leafItem.id} leaf={leafItem} isNewest={leafItem.id === newestId} />
          ))}
        </AnimatePresence>
      </svg>
    </main>
  );
}

function arrangeLeaves(leaves) {
  const placed = [];
  const minDistance = leaves.length > 150 ? 34 : 44;

  for (const leafItem of leaves) {
    let x = leafItem.x || TREE_WIDTH / 2;
    let y = leafItem.y || TREE_HEIGHT / 2;
    let guard = 0;

    while (guard < 24 && placed.some((other) => Math.hypot(other.x - x, other.y - y) < minDistance)) {
      const angle = (guard * 137.5 * Math.PI) / 180;
      const distance = 12 + guard * 3.2;
      x = Math.min(1040, Math.max(160, x + Math.cos(angle) * distance));
      y = Math.min(535, Math.max(95, y + Math.sin(angle) * distance * 0.7));
      guard += 1;
    }
    placed.push({ ...leafItem, x, y, rotate: ((hashText(leafItem.id) % 50) - 25) / 2 });
  }

  return placed;
}

function WishLeaf({ leaf: leafItem, isNewest }) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: isNewest ? 1.16 : 1 }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ type: "spring", stiffness: 130, damping: 16 }}
      transform={`translate(${leafItem.x} ${leafItem.y}) rotate(${leafItem.rotate})`}
      style={{ transformOrigin: `${leafItem.x}px ${leafItem.y}px` }}
    >
      <motion.path
        d="M0,-23 C27,-28 47,-8 45,14 C23,31 -9,28 -32,8 C-26,-10 -15,-20 0,-23 Z"
        fill={leafItem.color || LEAF_COLORS[0]}
        stroke="#173b27"
        strokeOpacity="0.16"
        strokeWidth="2"
        animate={isNewest ? { filter: ["drop-shadow(0 0 0px #f3e572)", "drop-shadow(0 0 18px #f3e572)", "drop-shadow(0 0 0px #f3e572)"] } : {}}
        transition={{ duration: 1.8, repeat: isNewest ? 2 : 0 }}
      />
      <path d="M-20,5 C-4,3 15,0 34,-10" fill="none" stroke="#173b27" strokeOpacity="0.24" strokeWidth="2" />
      <text
        x="4"
        y="8"
        textAnchor="middle"
        className="leaf-name"
      >
        {leafItem.name}
      </text>
    </motion.g>
  );
}

function TreeSvg() {
  return (
    <g>
      <ellipse cx="610" cy="710" rx="430" ry="38" fill="#29412e" opacity="0.13" />
      <path d="M560,690 C590,570 575,430 602,305 C620,430 636,570 675,690 Z" fill="#6f4a2a" />
      <path d="M604,318 C500,330 402,360 286,450" fill="none" stroke="#6f4a2a" strokeWidth="32" strokeLinecap="round" />
      <path d="M608,306 C695,318 810,360 920,455" fill="none" stroke="#6f4a2a" strokeWidth="34" strokeLinecap="round" />
      <path d="M600,265 C520,240 445,205 365,150" fill="none" stroke="#7b5430" strokeWidth="22" strokeLinecap="round" />
      <path d="M613,255 C705,236 792,202 875,140" fill="none" stroke="#7b5430" strokeWidth="22" strokeLinecap="round" />
      <path d="M590,360 C470,420 375,495 255,560" fill="none" stroke="#7b5430" strokeWidth="18" strokeLinecap="round" />
      <path d="M625,365 C745,420 838,498 960,560" fill="none" stroke="#7b5430" strokeWidth="18" strokeLinecap="round" />
      <path d="M603,250 C597,190 592,145 575,82" fill="none" stroke="#7b5430" strokeWidth="18" strokeLinecap="round" />
      <path d="M415,190 C375,232 330,260 270,285" fill="none" stroke="#8a6239" strokeWidth="12" strokeLinecap="round" />
      <path d="M780,190 C830,225 885,252 952,275" fill="none" stroke="#8a6239" strokeWidth="12" strokeLinecap="round" />
      <path d="M482,388 C432,342 385,315 326,308" fill="none" stroke="#8a6239" strokeWidth="12" strokeLinecap="round" />
      <path d="M744,390 C800,340 850,315 922,306" fill="none" stroke="#8a6239" strokeWidth="12" strokeLinecap="round" />
      <path d="M585,684 C612,590 598,470 607,316" fill="none" stroke="#9a6c40" strokeWidth="18" strokeLinecap="round" opacity="0.58" />
    </g>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
