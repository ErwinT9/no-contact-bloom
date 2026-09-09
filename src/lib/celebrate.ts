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

const COLORS = ["#6BCB77", "#DDF8E8", "#EAF6FF", "#F3EDFF", "#FFEAEA"];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fewer particles where the WebView has little headroom. */
function particleCount(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  if (cores <= 4 || memory <= 4) return 55;
  return 90;
}

function ensureInstance(confetti: ConfettiModule["default"]) {
  if (instance && canvas?.isConnected) return instance;
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
  document.body.appendChild(canvas);
  instance = confetti.create(canvas, { resize: true, useWorker: true });
  return instance;
}

function teardown() {
  try {
    instance?.reset();
  } catch {
    /* ignore */
  }
  canvas?.remove();
  canvas = null;
  instance = null;
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
      const fire = ensureInstance(mod.default);
      await fire({
        particleCount: particleCount(),
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
      inFlight = null;
    }
  })();

  return inFlight;
}
