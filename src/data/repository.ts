import { supabase } from "@/integrations/supabase/client";
import { analytics } from "@/lib/analytics";
import { STORAGE_KEYS, storage } from "@/lib/native/storage";
import { isOnline } from "@/lib/offline/network";
import { enqueue, type SyncTable } from "@/lib/offline/syncQueue";

import type {
  Affirmation,
  BadgeRow,
  DailyPromise,
  Flag,
  JournalEntry,
  Letter,
  MoodCheckin,
  Picture,
  Profile,
  QuestionnaireAnswers,
  Ritual,
  Streak,
  Trigger,
  Win,
} from "./types";
import type { GratitudeEntry, JourneyLevel, JourneyProgress, WorryEntry } from "./types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const localId = newId;

const CACHES = [
  "profile",
  "streak",
  "questionnaire",
  "flags",
  "wins",
  "badges",
  "letters",
  "promises",
  "pictures",
  "affirmations",
  "rituals",
  "triggers",
  "journal",
  "moods",
  "worries",
  "gratitude",
  "journey",
  "journeyLevels",
] as const;

async function cacheRead<T>(name: string, userId: string, fallback: T): Promise<T> {
  return storage.get<T>(STORAGE_KEYS.cache(name, userId), fallback);
}

async function cacheWrite(name: string, userId: string, value: unknown): Promise<void> {
  await storage.set(STORAGE_KEYS.cache(name, userId), value);
}

/**
 * Android WebViews frequently report `navigator.onLine === true` on a dead
 * connection (captive portals, doze, flaky mobile data). A Supabase fetch then
 * hangs forever and the UI waits on a promise that never settles — which is
 * why Save/Celebrate buttons stayed disabled offline. Every network call is
 * therefore bounded; a timeout is treated exactly like being offline.
 */
const NETWORK_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Offline-first read: resolve from the local cache instantly, then refresh from
 * Supabase when a connection exists. Never throws to the UI.
 */
async function readThrough<T>(
  name: string,
  userId: string,
  fallback: T,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await cacheRead<T>(name, userId, fallback);
  if (!isOnline()) return cached;
  try {
    const fresh = await withTimeout(fetcher());
    await cacheWrite(name, userId, fresh);
    return fresh;
  } catch (error) {
    analytics.error(error, { stage: "read_through", name });
    return cached;
  }
}

async function writeThrough(
  table: SyncTable,
  id: string,
  payload: Record<string, unknown>,
  onConflict?: string,
): Promise<void> {
  // When online, persist immediately so a follow-up read-through can't race the
  // background queue and return stale server state.
  if (isOnline()) {
    try {
      const { error } = await withTimeout(
        Promise.resolve(
          supabase.from(table).upsert(payload as never, { onConflict: onConflict ?? "id" }),
        ),
      );
      if (error) throw error;
      return;
    } catch (error) {
      analytics.error(error, { stage: "write_through", table });
    }
  }
  await enqueue(
    onConflict
      ? { id, table, op: "upsert", payload, onConflict }
      : { id, table, op: "upsert", payload },
  );
}

export function emptyProfile(userId: string): Profile {
  return {
    id: userId,
    display_name: null,
    bio: null,
    avatar_url: null,
    recovery_started_at: new Date().toISOString(),
    notifications_enabled: false,
    notification_prefs: { morning: true, evening: true, reminder: true, motivation: true },
    push_token: null,
    questionnaire_completed: false,
    is_premium: false,
  };
}

export const profileRepo = {
  async get(userId: string): Promise<Profile | null> {
    return readThrough<Profile | null>("profile", userId, null, async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? (data as unknown as Profile) : null;
    });
  },
  async update(userId: string, patch: Partial<Profile>): Promise<Profile> {
    const current = await cacheRead<Profile | null>("profile", userId, null);
    const merged = { ...(current ?? emptyProfile(userId)), ...patch, id: userId } as Profile &
      Record<string, unknown>;
    // Legacy columns no longer exist in Supabase — never write them back.
    delete merged['morning_reminder'];
    delete merged['evening_reminder'];
    const next: Profile = merged;
    await cacheWrite("profile", userId, next);
    await writeThrough("profiles", userId, { ...next });
    return next;
  },
};

export const streakRepo = {
  async get(userId: string): Promise<Streak | null> {
    return readThrough<Streak | null>("streak", userId, null, async () => {
      const { data, error } = await supabase
        .from("streaks")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? (data as unknown as Streak) : null;
    });
  },
  async save(userId: string, streak: Streak): Promise<Streak> {
    await cacheWrite("streak", userId, streak);
    await writeThrough("streaks", streak.id, { ...streak, user_id: userId }, "user_id");
    return streak;
  },
  async ensure(userId: string, startedAt?: string): Promise<Streak> {
    const existing = await streakRepo.get(userId);
    if (existing) return existing;
    const created: Streak = {
      id: newId(),
      user_id: userId,
      started_at: startedAt ?? new Date().toISOString(),
      best_days: 0,
      relapse_count: 0,
      ex_name: null,
    };
    return streakRepo.save(userId, created);
  },
  async reset(userId: string, current: Streak, daysLasted: number): Promise<Streak> {
    const next: Streak = {
      ...current,
      started_at: new Date().toISOString(),
      best_days: Math.max(current.best_days, daysLasted),
      relapse_count: current.relapse_count + 1,
    };
    return streakRepo.save(userId, next);
  },
  async setStart(userId: string, current: Streak, startedAt: string): Promise<Streak> {
    return streakRepo.save(userId, { ...current, started_at: startedAt });
  },
};

export const questionnaireRepo = {
  async get(userId: string): Promise<QuestionnaireAnswers | null> {
    return readThrough<QuestionnaireAnswers | null>("questionnaire", userId, null, async () => {
      const { data, error } = await supabase
        .from("questionnaire_answers")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? (data as unknown as QuestionnaireAnswers) : null;
    });
  },
  async save(
    userId: string,
    patch: Partial<QuestionnaireAnswers>,
  ): Promise<QuestionnaireAnswers> {
    const current = await cacheRead<QuestionnaireAnswers | null>("questionnaire", userId, null);
    const next: QuestionnaireAnswers = {
      id: current?.id ?? newId(),
      user_id: userId,
      nickname: null,
      age_range: null,
      gender: null,
      relationship_length: null,
      who_ended: null,
      last_contact_at: null,
      reasons: [],
      checks_social: null,
      difficulty_today: null,
      biggest_goal: null,
      wants_reminders: null,
      referral_source: null,
      completed: false,
      ...(current ?? {}),
      ...patch,
    };
    await cacheWrite("questionnaire", userId, next);
    await writeThrough("questionnaire_answers", next.id, { ...next }, "user_id");
    return next;
  },
};

export const flagRepo = {
  async list(userId: string): Promise<Flag[]> {
    return readThrough<Flag[]>("flags", userId, [], async () => {
      const { data, error } = await supabase
        .from("flags")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Flag[];
    });
  },
  async save(userId: string, input: Partial<Flag> & { title: string }): Promise<Flag[]> {
    const list = await cacheRead<Flag[]>("flags", userId, []);
    const flag: Flag = {
      id: input.id ?? newId(),
      user_id: userId,
      title: input.title,
      category: input.category ?? "other",
      note: input.note ?? null,
      created_at: input.created_at ?? new Date().toISOString(),
    };
    const next = [flag, ...list.filter((item) => item.id !== flag.id)];
    await cacheWrite("flags", userId, next);
    await writeThrough("flags", flag.id, { ...flag });
    return next;
  },
  async remove(userId: string, id: string): Promise<Flag[]> {
    const list = await cacheRead<Flag[]>("flags", userId, []);
    const next = list.filter((item) => item.id !== id);
    await cacheWrite("flags", userId, next);
    await enqueue({ id, table: "flags", op: "delete", payload: { id } });
    return next;
  },
};

export const winRepo = {
  async list(userId: string): Promise<Win[]> {
    return readThrough<Win[]>("wins", userId, [], async () => {
      const { data, error } = await supabase
        .from("wins")
        .select("*")
        .eq("user_id", userId)
        .order("achieved_on", { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data ?? []) as unknown as Win[];
    });
  },
  async save(userId: string, input: Partial<Win> & { title: string }): Promise<Win[]> {
    const list = await cacheRead<Win[]>("wins", userId, []);
    const win: Win = {
      id: input.id ?? newId(),
      user_id: userId,
      title: input.title,
      note: input.note ?? null,
      achieved_on: input.achieved_on ?? localDayKey(),
      created_at: input.created_at ?? new Date().toISOString(),
    };
    const next = [win, ...list.filter((item) => item.id !== win.id)];
    await cacheWrite("wins", userId, next);
    await writeThrough("wins", win.id, { ...win });
    return next;
  },
  async remove(userId: string, id: string): Promise<Win[]> {
    const list = await cacheRead<Win[]>("wins", userId, []);
    const next = list.filter((item) => item.id !== id);
    await cacheWrite("wins", userId, next);
    await enqueue({ id, table: "wins", op: "delete", payload: { id } });
    return next;
  },
};

export const badgeRepo = {
  async list(userId: string): Promise<BadgeRow[]> {
    return readThrough<BadgeRow[]>("badges", userId, [], async () => {
      const { data, error } = await supabase
        .from("badges")
        .select("*")
        .eq("user_id", userId)
        .order("unlocked_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BadgeRow[];
    });
  },
  async unlock(userId: string, badgeKeys: string[]): Promise<BadgeRow[]> {
    const list = await cacheRead<BadgeRow[]>("badges", userId, []);
    const owned = new Set(list.map((badge) => badge.badge_key));
    const fresh = badgeKeys.filter((key) => !owned.has(key));
    if (fresh.length === 0) return list;

    const rows: BadgeRow[] = fresh.map((key) => ({
      id: newId(),
      user_id: userId,
      badge_key: key,
      unlocked_at: new Date().toISOString(),
    }));
    const next = [...rows, ...list];
    await cacheWrite("badges", userId, next);
    for (const row of rows) {
      await writeThrough("badges", row.id, { ...row }, "user_id,badge_key");
    }
    return next;
  },
};

export const letterRepo = {
  async list(userId: string): Promise<Letter[]> {
    return readThrough<Letter[]>("letters", userId, [], async () => {
      const { data, error } = await supabase
        .from("letters")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Letter[];
    });
  },
  async save(userId: string, input: Partial<Letter> & { body: string }): Promise<Letter[]> {
    const list = await cacheRead<Letter[]>("letters", userId, []);
    const now = new Date().toISOString();
    const letter: Letter = {
      id: input.id ?? newId(),
      user_id: userId,
      title: input.title ?? null,
      body: input.body,
      emotion: input.emotion ?? null,
      is_draft: input.is_draft ?? false,
      created_at: input.created_at ?? now,
      updated_at: now,
    };
    const next = [letter, ...list.filter((item) => item.id !== letter.id)];
    await cacheWrite("letters", userId, next);
    await writeThrough("letters", letter.id, { ...letter });
    return next;
  },
  async remove(userId: string, id: string): Promise<Letter[]> {
    const list = await cacheRead<Letter[]>("letters", userId, []);
    const next = list.filter((item) => item.id !== id);
    await cacheWrite("letters", userId, next);
    await enqueue({ id, table: "letters", op: "delete", payload: { id } });
    return next;
  },
};

export async function clearUserCache(userId: string): Promise<void> {
  await Promise.all(CACHES.map((name) => storage.remove(STORAGE_KEYS.cache(name, userId))));
}

/** Builds an offline-first list repository for the simple activity tables. */
function listRepo<T extends { id: string; user_id: string; created_at: string }>(
  cacheName: string,
  table: SyncTable,
  defaults: (userId: string) => Omit<T, "id" | "user_id" | "created_at">,
) {
  return {
    async list(userId: string): Promise<T[]> {
      return readThrough<T[]>(cacheName, userId, [], async () => {
        const { data, error } = await supabase
          .from(table as "flags")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(300);
        if (error) throw error;
        return (data ?? []) as unknown as T[];
      });
    },
    async save(userId: string, input: Partial<T>): Promise<T[]> {
      const list = await cacheRead<T[]>(cacheName, userId, []);
      const row = {
        ...defaults(userId),
        id: input.id ?? newId(),
        user_id: userId,
        created_at: input.created_at ?? new Date().toISOString(),
        ...input,
      } as T;
      const next = [row, ...list.filter((item) => item.id !== row.id)];
      await cacheWrite(cacheName, userId, next);
      await writeThrough(table, row.id, { ...row });
      return next;
    },
    async remove(userId: string, id: string): Promise<T[]> {
      const list = await cacheRead<T[]>(cacheName, userId, []);
      const next = list.filter((item) => item.id !== id);
      await cacheWrite(cacheName, userId, next);
      await enqueue({ id, table, op: "delete", payload: { id } });
      return next;
    },
  };
}

export const pictureRepo = listRepo<Picture>("pictures", "pictures", () => ({
  image_url: "",
  caption: null,
  taken_on: localDayKey(),
  storage_kind: "drive" as const,
  drive_file_id: null,
  drive_web_link: null,
}));

export const affirmationRepo = listRepo<Affirmation>("affirmations", "affirmations", () => ({
  body: "",
}));

export const ritualRepo = listRepo<Ritual>("rituals", "rituals", () => ({
  title: "",
  note: null,
}));

export const worryRepo = listRepo<WorryEntry>("worries", "worry_entries", () => ({
  worry_text: "",
}));

export const gratitudeRepo = listRepo<GratitudeEntry>("gratitude", "gratitude_entries", () => ({
  gratitude_text: "",
  item_type: "heart" as const,
}));

export const triggerRepo = listRepo<Trigger>("triggers", "triggers", () => ({
  title: "",
  note: null,
}));

export const journalRepo = listRepo<JournalEntry>("journal", "journal_entries", () => ({
  title: null,
  body: "",
  mood: null,
}));

const promiseList = listRepo<DailyPromise>("promises", "daily_promises", () => ({
  promised_on: localDayKey(),
}));

export const promiseRepo = {
  list: promiseList.list,
  async makeToday(userId: string): Promise<DailyPromise[]> {
    const today = localDayKey();
    const list = await promiseList.list(userId);
    if (list.some((item) => item.promised_on === today)) return list;
    return promiseList.save(userId, { promised_on: today });
  },
};

/** Local (device-timezone) calendar day key, so check-ins roll over at midnight. */
export function localDayKey(date: Date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export const moodRepo = {
  async list(userId: string): Promise<MoodCheckin[]> {
    return readThrough<MoodCheckin[]>("moods", userId, [], async () => {
      const { data, error } = await supabase
        .from("mood_checkins")
        .select("*")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as MoodCheckin[];
    });
  },
  async today(userId: string): Promise<MoodCheckin | null> {
    const list = await moodRepo.list(userId);
    const today = localDayKey();
    return list.find((item) => item.checkin_on === today) ?? null;
  },
  /** All of today's entries, newest first. */
  async todayEntries(userId: string): Promise<MoodCheckin[]> {
    const list = await moodRepo.list(userId);
    const today = localDayKey();
    return list
      .filter((item) => item.checkin_on === today)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  },
  async save(
    userId: string,
    input: { mood: string; action: string | null; custom_intention: string | null },
  ): Promise<MoodCheckin[]> {
    const list = await cacheRead<MoodCheckin[]>("moods", userId, []);
    const today = localDayKey();
    const now = new Date().toISOString();
    // Every selection is an independent record — entries are never overwritten.
    const row: MoodCheckin = {
      id: newId(),
      user_id: userId,
      checkin_on: today,
      mood: input.mood,
      action: input.action,
      custom_intention: input.custom_intention,
      completed_at: now,
      created_at: now,
    };
    const next = [row, ...list];
    await cacheWrite("moods", userId, next);
    await writeThrough("mood_checkins", row.id, { ...row });
    return next;
  },
};

/* ------------------------------------------------------------------ */
/* Journey (Motivation → Journey) progress                             */
/* ------------------------------------------------------------------ */

function emptyJourneyRow(
  userId: string,
  levelId: string,
  activityId: string,
): JourneyProgress {
  const now = new Date().toISOString();
  return {
    id: newId(),
    user_id: userId,
    level_id: levelId,
    activity_id: activityId,
    status: "in_progress",
    completed: false,
    completed_at: null,
    day_dates: [],
    data: {},
    created_at: now,
    updated_at: now,
  };
}

export const journeyRepo = {
  async list(userId: string): Promise<JourneyProgress[]> {
    return readThrough<JourneyProgress[]>("journey", userId, [], async () => {
      const { data, error } = await supabase
        .from("journey_progress")
        .select("*")
        .eq("user_id", userId)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as JourneyProgress[];
    });
  },

  async levels(userId: string): Promise<JourneyLevel[]> {
    return readThrough<JourneyLevel[]>("journeyLevels", userId, [], async () => {
      const { data, error } = await supabase
        .from("journey_levels")
        .select("*")
        .eq("user_id", userId)
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as JourneyLevel[];
    });
  },

  /**
   * Idempotent upsert keyed on (user_id, activity_id) so repeated taps, retries
   * and offline replays can never create a duplicate progress record.
   */
  async upsert(
    userId: string,
    levelId: string,
    activityId: string,
    patch: Partial<Pick<JourneyProgress, "status" | "completed" | "completed_at" | "day_dates" | "data">>,
  ): Promise<JourneyProgress[]> {
    const list = await cacheRead<JourneyProgress[]>("journey", userId, []);
    const current =
      list.find((row) => row.activity_id === activityId) ??
      emptyJourneyRow(userId, levelId, activityId);
    const row: JourneyProgress = {
      ...current,
      ...patch,
      data: { ...current.data, ...(patch.data ?? {}) },
      level_id: levelId,
      updated_at: new Date().toISOString(),
    };
    const next = [row, ...list.filter((item) => item.activity_id !== activityId)];
    await cacheWrite("journey", userId, next);
    await writeThrough("journey_progress", row.id, { ...row }, "user_id,activity_id");
    return next;
  },

  /** Records today's local calendar date once per day for multi-day activities. */
  async markDay(
    userId: string,
    levelId: string,
    activityId: string,
  ): Promise<JourneyProgress[]> {
    const list = await cacheRead<JourneyProgress[]>("journey", userId, []);
    const current = list.find((row) => row.activity_id === activityId);
    const today = localDayKey();
    const days = current?.day_dates ?? [];
    if (days.includes(today)) return list;
    return journeyRepo.upsert(userId, levelId, activityId, {
      day_dates: [...days, today].sort(),
      status: "in_progress",
    });
  },

  async complete(
    userId: string,
    levelId: string,
    activityId: string,
    data?: Record<string, unknown>,
  ): Promise<JourneyProgress[]> {
    const list = await cacheRead<JourneyProgress[]>("journey", userId, []);
    const current = list.find((row) => row.activity_id === activityId);
    if (current?.completed) {
      // Revisiting a finished activity never rewrites its completion stamp.
      return data ? journeyRepo.upsert(userId, levelId, activityId, { data }) : list;
    }
    return journeyRepo.upsert(userId, levelId, activityId, {
      completed: true,
      status: "completed",
      completed_at: new Date().toISOString(),
      ...(data ? { data } : {}),
    });
  },

  async completeLevel(userId: string, levelId: string): Promise<JourneyLevel[]> {
    const list = await cacheRead<JourneyLevel[]>("journeyLevels", userId, []);
    const current = list.find((row) => row.level_id === levelId);
    if (current?.completed) return list;
    const now = new Date().toISOString();
    const row: JourneyLevel = {
      id: current?.id ?? newId(),
      user_id: userId,
      level_id: levelId,
      completed: true,
      completed_at: now,
      created_at: current?.created_at ?? now,
      updated_at: now,
    };
    const next = [row, ...list.filter((item) => item.level_id !== levelId)];
    await cacheWrite("journeyLevels", userId, next);
    await writeThrough("journey_levels", row.id, { ...row }, "user_id,level_id");
    return next;
  },
};
