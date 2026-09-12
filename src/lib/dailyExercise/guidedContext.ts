/**
 * Remembers that the user opened an EXISTING feature *from* the Daily Guided
 * Exercise. This is navigation context only: no feature behaviour, UI or save
 * logic depends on it, and when it is absent every feature works exactly as it
 * always has.
 *
 * Stored in sessionStorage so it survives a reload/resume of the same app
 * session, and cleared as soon as the user is back on the exercise screen or
 * deliberately leaves the guided flow.
 */
export type GuidedContext = {
  /** Step `order` of the guided-exercise step that opened the feature. */
  order: number;
  /** Route the step opened, used to know when the user has wandered off. */
  path: string;
  /** Existing feature list watched for a real new entry, if any. */
  count: string | null;
  /** Row count of that list when the step was started. */
  baseline: number;
  /** Curated session that is active today, kept so the return is exact. */
  sessionId?: string | null;
  /** Local calendar day the active session belongs to. */
  localDate?: string | null;
};

/**
 * True while the user is still inside the feature the step opened — including
 * any of that feature's own sub-screens (e.g. a healing-audio category).
 */
export function matchesGuidedPath(contextPath: string, pathname: string): boolean {
  return pathname === contextPath || pathname.startsWith(`${contextPath}/`);
}

const KEY = "steady.guidedExerciseContext";
const EVENT = "steady:guided-exercise-context";

function read(): GuidedContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GuidedContext) : null;
  } catch {
    return null;
  }
}

export function getGuidedContext(): GuidedContext | null {
  return read();
}

export function setGuidedContext(context: GuidedContext): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(context));
  } catch {
    /* context is a convenience only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearGuidedContext(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeGuidedContext(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
