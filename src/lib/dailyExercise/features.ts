/**
 * Mapping layer between the JSON `feature` ids and the app's EXISTING
 * features. Nothing here re-implements a feature — every entry either points at
 * an existing route, opens the existing emergency toolkit, or renders the
 * existing Mood Check-In component.
 */

/** Which existing local list a "save" step watches for a brand new entry. */
export type ExerciseCountSource =
  | "moods"
  | "journal"
  | "triggers"
  | "flags"
  | "wins"
  | "letters"
  | "affirmations"
  | "worries"
  | "gratitude";

export const FEATURE_MAP = {
  mood_check_in: { kind: "mood", label: "Start Mood Check-In", count: "moods" },
  triggers: { kind: "save", to: "/triggers", label: "Log a Trigger", count: "triggers" },
  journal: { kind: "save", to: "/journal", label: "Open Journal", count: "journal" },
  red_flags: { kind: "save", to: "/flags", label: "Add a Red Flag", count: "flags" },
  reading_red_flags: { kind: "practice", to: "/flags", label: "Read Your Red Flags" },
  wins: { kind: "save", to: "/wins", label: "Record a Win", count: "wins" },
  reading_wins: { kind: "practice", to: "/wins", label: "Read Your Wins" },
  unsent_letters: {
    kind: "save",
    to: "/letters",
    label: "Write an Unsent Letter",
    count: "letters",
  },
  affirmations: {
    kind: "save",
    to: "/affirmations",
    label: "Open Affirmations",
    count: "affirmations",
  },
  worry_box: {
    kind: "save",
    to: "/motivation/worry-box",
    label: "Open Worry Box",
    count: "worries",
  },
  gratitude_jar: {
    kind: "save",
    to: "/motivation/gratitude-jar",
    label: "Open Gratitude Jar",
    count: "gratitude",
  },
  daily_motivation: {
    kind: "practice",
    to: "/motivation/guide",
    label: "Open Daily Motivation",
  },
  journey: { kind: "practice", to: "/motivation/journey", label: "Open Journey" },
  goals_routines: { kind: "practice", to: "/motivation", label: "Open Goals & Routines" },
  healing_audio: {
    kind: "practice",
    to: "/motivation/healing-audio",
    label: "Open Healing Audio",
  },
  outdoor_walk: { kind: "practice", to: "/motivation/walk", label: "Start Outdoor Walk" },
  daily_tasks: { kind: "practice", to: "/home", label: "Open Daily Tasks" },
  no_contact_streak: { kind: "practice", to: "/home", label: "View Your No Contact Streak" },
  breathing: { kind: "practice", sos: "breathe", label: "Start Breathing" },
  grounding: { kind: "practice", sos: "ground", label: "Start Grounding (5-4-3-2-1)" },
  fight_the_urge: { kind: "practice", sos: "urge", label: "Open Fight the Urge" },
} as const;

export type FeatureEntry = (typeof FEATURE_MAP)[keyof typeof FEATURE_MAP];

export function featureEntry(feature: string): FeatureEntry | null {
  return (FEATURE_MAP as Record<string, FeatureEntry | undefined>)[feature] ?? null;
}

export function featureLabel(feature: string): string {
  return featureEntry(feature)?.label ?? "Open Feature";
}
