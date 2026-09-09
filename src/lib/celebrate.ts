import { haptic } from "@/lib/native/haptics";

/**
 * Confetti burst + haptic used for badge unlocks. Never throws.
 *
 * Performance notes (Android/Capacitor WebView was dropping frames):
 * - One reusable canvas + one confetti instance, created lazily and kept
 *   around, instead of canvas-confetti's global helper which creates and
 *   resizes a fresh full-screen canvas on every call.
 * - `useWorker: true` moves the particle simulation and painting to a Web
 *   Worker via OffscreenCanvas, so the main/UI thread stays free for React
 *   renders and the Home screen's other animations.
 * - Overlapping calls are collapsed: several unlocks firing at once reuse the
 *   single in-flight burst instead of stacking canvases and particle loops.
 * - Particle count is reduced on low-core / low-memory devices, and skipped
 *   entirely when the user prefers reduced motion.
 * - The instance is reset and the canvas removed once the burst completes.
 */

type ConfettiFn = (options: Record<string, unknown>) => Promise<null> | null;
type ConfettiModule = {
  default: ConfettiFn & {
    create: (
      canvas: HTMLCanvasElement,
      options: { resize?: boolean; useWorker?: boolean },
    ) => ConfettiFn & { reset: () => void };
  };
};

let modulePromise: Promise<ConfettiModule> | null = null;
let canvas: HTMLCanvasElement | null = null;
let instance: (ConfettiFn & { reset: () => void }) | null = null;
let inFlight: Promise<void> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

const COLORS = ["#6BCB77", "#DDF8E8", "#EAF6FF", "#F3EDFF", "#FFEAEA"];
/** Hard stop so a stalled/backgrounded WebView can never leak the canvas. */
const MAX_DURATION_MS = 4000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Same capability gate canvas-confetti uses internally. Older Android System
 * WebView builds lack OffscreenCanvas / transferControlToOffscreen, in which
 * case the library silently ignores `useWorker` and paints on the main thread —
 * so we detect it here too and trim the particle budget for that path.
 */
function canUseWorker(): boolean {
  try {
    const g = window as unknown as Record<string, unknown>;
    return !!(
      g["Worker"] &&
      g["Blob"] &&
      g["OffscreenCanvas"] &&
      g["OffscreenCanvasRenderingContext2D"] &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
    );
  } catch {
    return false;
  }
}

/** Fewer particles where the WebView has little headroom. */
function particleCount(worker: boolean): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const lowEnd = cores <= 4 || memory <= 4;
  if (!worker) return lowEnd ? 35 : 55;
  return lowEnd ? 55 : 90;
}

function ensureInstance(confetti: ConfettiModule["default"], worker: boolean) {
  if (instance && canvas?.isConnected) return instance;
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
  document.body.appendChild(canvas);
  instance = confetti.create(canvas, { resize: true, useWorker: worker });
  return instance;
}

function teardown() {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  try {
    instance?.reset();
  } catch {
    /* ignore */
  }
  canvas?.remove();
  canvas = null;
  instance = null;
  inFlight = null;
}


export async function celebrate(): Promise<void> {
  haptic.success();
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (prefersReducedMotion()) return;
  // Collapse overlapping bursts into the one already running.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      modulePromise ??= import("canvas-confetti") as unknown as Promise<ConfettiModule>;
      const mod = await modulePromise;
      const worker = canUseWorker();
      const fire = ensureInstance(mod.default, worker);
      safetyTimer = setTimeout(teardown, MAX_DURATION_MS);
      await fire({
        particleCount: particleCount(worker),
        spread: 78,
        startVelocity: 38,
        origin: { y: 0.7 },
        colors: COLORS,
        disableForReducedMotion: true,
      });
    } catch {
      /* confetti is decorative only */
    } finally {
      teardown();
    }
  })();

  return inFlight;
}

