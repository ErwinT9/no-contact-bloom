/**
 * Single content layer for the Daily Guided Exercise.
 *
 * The curated sessions live in `src/data/dailyGuidedExercises.json` exactly as
 * authored — nothing here rewrites, shortens or renames content. Adding more
 * sessions to that JSON is all it takes to extend the feature.
 */
import raw from "@/data/dailyGuidedExercises.json";

export type ExerciseFeatureId = string;

export type ExerciseStep = {
  order: number;
  title: string;
  instruction: string;
  why: string;
  feature: ExerciseFeatureId;
};

export type ExerciseSession = {
  id: string;
  title: string;
  category: string;
  estimated_minutes: number;
  purpose: string;
  steps: ExerciseStep[];
  completion: { title: string; message: string };
};

type ExerciseContent = {
  version: number;
  feature: string;
  selection_mode: string;
  sessions: ExerciseSession[];
};

const content = raw as ExerciseContent;

export const EXERCISE_CONTENT_VERSION = content.version;

/** All curated sessions, in JSON order. */
export const EXERCISE_SESSIONS: ExerciseSession[] = content.sessions;

export function sessionById(id: string | null | undefined): ExerciseSession | null {
  if (!id) return null;
  return EXERCISE_SESSIONS.find((session) => session.id === id) ?? null;
}

/** Steps sorted by their authored order — the sequence is never shuffled. */
export function orderedSteps(session: ExerciseSession): ExerciseStep[] {
  return [...session.steps].sort((a, b) => a.order - b.order);
}
