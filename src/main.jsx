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

const CANOPY_CENTER = { x: 610, y: 245 };
const CANOPY_RADIUS = { x: 420, y: 190 };

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
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return leaves.map((leafItem, index) => {
    const ringProgress = Math.sqrt((index + 0.5) / Math.max(leaves.length, 1));
    const angle = index * goldenAngle + (hashText(leafItem.id) % 21) / 10;
    const wobble = ((hashText(`${leafItem.id}-wobble`) % 100) - 50) / 100;
    const x = CANOPY_CENTER.x + Math.cos(angle) * ringProgress * CANOPY_RADIUS.x;
    const y = CANOPY_CENTER.y + Math.sin(angle) * ringProgress * CANOPY_RADIUS.y + wobble * 22;

    return {
      ...leafItem,
      x: Math.round(Math.min(1030, Math.max(190, x))),
      y: Math.round(Math.min(455, Math.max(70, y))),
      rotate: (hashText(leafItem.id) % 70) - 35,
    };
  });
}

function WishLeaf({ leaf: leafItem, isNewest }) {
  return (
    <g transform={`translate(${leafItem.x} ${leafItem.y}) rotate(${leafItem.rotate})`}>
      <motion.g
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: isNewest ? 1.18 : 1 }}
        exit={{ opacity: 0, scale: 0 }}
        transition={{ type: "spring", stiffness: 130, damping: 16 }}
      >
        <motion.path
          d="M-7,-20 C18,-21 36,-5 42,16 C17,22 -8,17 -31,-2 C-25,-12 -17,-18 -7,-20 Z"
          fill={leafItem.color || LEAF_COLORS[0]}
          stroke="#0f5f2f"
          strokeOpacity="0.22"
          strokeWidth="2"
          animate={isNewest ? { filter: ["drop-shadow(0 0 0px #f3e572)", "drop-shadow(0 0 18px #f3e572)", "drop-shadow(0 0 0px #f3e572)"] } : {}}
          transition={{ duration: 1.8, repeat: isNewest ? 2 : 0 }}
        />
        <path d="M-23,-3 C-5,1 14,4 34,12" fill="none" stroke="#ffffff" strokeOpacity="0.34" strokeWidth="2" />
        <text x="5" y="7" textAnchor="middle" className="leaf-name">
          {leafItem.name}
        </text>
      </motion.g>
    </g>
  );
}

function TreeSvg() {
  return (
    <g>
      <ellipse cx="610" cy="710" rx="390" ry="34" fill="#29412e" opacity="0.13" />
      <path
        d="M536,688 C590,570 562,448 607,315 C655,448 630,570 686,688 Z"
        fill="#f47a28"
      />
      <path
        d="M607,318 C572,390 556,486 572,682"
        fill="none"
        stroke="#fff8ec"
        strokeWidth="18"
        strokeLinecap="round"
        opacity="0.92"
      />
      <path
        d="M607,326 C657,405 673,516 650,676"
        fill="none"
        stroke="#fff8ec"
        strokeWidth="16"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M604,342 C536,408 496,494 482,596"
        fill="none"
        stroke="#fff8ec"
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.88"
      />
      <path
        d="M618,342 C690,408 735,500 750,600"
        fill="none"
        stroke="#fff8ec"
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.88"
      />
    </g>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
