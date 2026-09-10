/**
 * Daily Guided Exercise persistence.
 *
 * Offline-first, exactly like the other repositories: everything is written to
 * device storage first so the session, its step progress and its completion
 * survive an app restart with no connection. Completed days are appended to a
 * local history that never overwrites earlier days.
 *
 * Cloud sync: the `daily_exercise_sessions` table is not part of the current
 * database schema, so pushing rows is gated behind CLOUD_SYNC_ENABLED. Once the
 * table exists, flipping the flag is the only change needed — the payload built
 * below is already the row shape, and it goes through the normal offline sync
 * queue.
 */
import { localDayKey } from "@/data/repository";
import { EXERCISE_SESSIONS, orderedSteps, sessionById } from "@/lib/dailyExercise/content";
import { STORAGE_KEYS, storage } from "@/lib/native/storage";
import { enqueue } from "@/lib/offline/syncQueue";

const CLOUD_SYNC_ENABLED = false;

export type DailyExerciseState = {
  local_date: string;
  session_id: string;
  started_at: string;
  /** Step `order` values already completed, in completion order. */
  completed_steps: number[];
  /** Step `order` values whose existing feature the user has opened. */
  opened_steps: number[];
  /** Step order -> row count in the related feature when the step was started. */
  baselines: Record<string, number>;
  completed: boolean;
  completed_at: string | null;
};

export type DailyExerciseRecord = {
  id: string;
  user_id: string;
  local_date: string;
  session_id: string;
  session_title: string;
  completed_steps: number;
  total_steps: number;
  status: "completed";
  completed_at: string;
  created_at: string;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const stateKey = (userId: string) => STORAGE_KEYS.cache("dailyExerciseState", userId);
const historyKey = (userId: string) => STORAGE_KEYS.cache("dailyExerciseHistory", userId);
const recentKey = (userId: string) => STORAGE_KEYS.cache("dailyExerciseRecent", userId);

/**
 * Picks one COMPLETE curated session, never mixing steps. Recently used
 * sessions are skipped so the same session can't land on consecutive days and
 * repetition stays rare; the cycle then continues indefinitely.
 */
function pickSessionId(recent: string[]): string {
  const all = EXERCISE_SESSIONS.map((session) => session.id);
  const skip = new Set(recent.slice(-Math.max(1, Math.min(recent.length, all.length - 1))));
  let candidates = all.filter((id) => !skip.has(id));
  if (candidates.length === 0) {
    const last = recent[recent.length - 1];
    candidates = all.filter((id) => id !== last);
  }
  if (candidates.length === 0) candidates = all;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? all[0]!;
}

function freshState(sessionId: string, date: string): DailyExerciseState {
  return {
    local_date: date,
    session_id: sessionId,
    started_at: new Date().toISOString(),
    completed_steps: [],
    opened_steps: [],
    baselines: {},
    completed: false,
    completed_at: null,
  };
}

export const dailyExerciseRepo = {
  async history(userId: string): Promise<DailyExerciseRecord[]> {
    const list = await storage.get<DailyExerciseRecord[]>(historyKey(userId), []);
    return [...list].sort((a, b) => b.local_date.localeCompare(a.local_date));
  },

  /**
   * Returns today's session state, selecting a session on the first open of a
   * new LOCAL calendar day and persisting it so reopening the app on the same
   * date always shows the same session.
   */
  async today(userId: string): Promise<DailyExerciseState> {
    const today = localDayKey();
    const stored = await storage.get<DailyExerciseState | null>(stateKey(userId), null);
    if (stored && stored.local_date === today && sessionById(stored.session_id)) return stored;

    const recent = await storage.get<string[]>(recentKey(userId), []);
    if (stored && sessionById(stored.session_id)) {
      // Yesterday's session must not repeat today.
      if (recent[recent.length - 1] !== stored.session_id) recent.push(stored.session_id);
    }
    const next = freshState(pickSessionId(recent), today);
    const trimmedRecent = [...recent, next.session_id].slice(-Math.max(2, EXERCISE_SESSIONS.length - 1));
    await storage.set(recentKey(userId), trimmedRecent);
    await storage.set(stateKey(userId), next);
    return next;
  },

  async setBaseline(
    userId: string,
    order: number,
    count: number,
  ): Promise<DailyExerciseState> {
    const state = await dailyExerciseRepo.today(userId);
    const next: DailyExerciseState = {
      ...state,
      baselines: { ...state.baselines, [String(order)]: count },
      opened_steps: state.opened_steps.includes(order)
        ? state.opened_steps
        : [...state.opened_steps, order],
    };
    await storage.set(stateKey(userId), next);
    return next;
  },

  async markOpened(userId: string, order: number): Promise<DailyExerciseState> {
    const state = await dailyExerciseRepo.today(userId);
    if (state.opened_steps.includes(order)) return state;
    const next: DailyExerciseState = {
      ...state,
      opened_steps: [...state.opened_steps, order],
    };
    await storage.set(stateKey(userId), next);
    return next;
  },

  async completeStep(userId: string, order: number): Promise<DailyExerciseState> {
    const state = await dailyExerciseRepo.today(userId);
    if (state.completed_steps.includes(order)) return state;
    const next: DailyExerciseState = {
      ...state,
      completed_steps: [...state.completed_steps, order],
    };
    await storage.set(stateKey(userId), next);
    return next;
  },

  /** Finishes the day: marks the local state complete and appends to history. */
  async finish(userId: string): Promise<DailyExerciseState> {
    const state = await dailyExerciseRepo.today(userId);
    if (state.completed) return state;
    const session = sessionById(state.session_id);
    const total = session ? orderedSteps(session).length : state.completed_steps.length;
    const completedAt = new Date().toISOString();
    const next: DailyExerciseState = { ...state, completed: true, completed_at: completedAt };
    await storage.set(stateKey(userId), next);

    const history = await storage.get<DailyExerciseRecord[]>(historyKey(userId), []);
    const record: DailyExerciseRecord = {
      id: newId(),
      user_id: userId,
      local_date: state.local_date,
      session_id: state.session_id,
      session_title: session?.title ?? state.session_id,
      completed_steps: state.completed_steps.length,
      total_steps: total,
      status: "completed",
      completed_at: completedAt,
      created_at: completedAt,
    };
    const merged = [record, ...history.filter((row) => row.local_date !== record.local_date)];
    await storage.set(historyKey(userId), merged);

    if (CLOUD_SYNC_ENABLED) {
      await enqueue({
        id: record.id,
        table: "daily_exercise_sessions" as never,
        op: "upsert",
        payload: { ...record, updated_at: completedAt },
        onConflict: "user_id,local_date",
      });
    }
    return next;
  },
};
