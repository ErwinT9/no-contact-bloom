/**
 * Reads the row count of an EXISTING feature's own list. Nothing here writes or
 * re-implements a feature — it only observes what the feature already saved, so
 * a guided-exercise step can be completed by a real save and nothing else.
 */
import {
  affirmationRepo,
  flagRepo,
  gratitudeRepo,
  journalRepo,
  letterRepo,
  moodRepo,
  triggerRepo,
  winRepo,
  worryRepo,
} from "@/data/repository";
import type { ExerciseCountSource } from "@/lib/dailyExercise/features";

export async function countFor(source: ExerciseCountSource, userId: string): Promise<number> {
  switch (source) {
    case "moods":
      return (await moodRepo.list(userId)).length;
    case "journal":
      return (await journalRepo.list(userId)).length;
    case "triggers":
      return (await triggerRepo.list(userId)).length;
    case "flags":
      return (await flagRepo.list(userId)).length;
    case "wins":
      return (await winRepo.list(userId)).length;
    case "letters":
      return (await letterRepo.list(userId)).length;
    case "affirmations":
      return (await affirmationRepo.list(userId)).length;
    case "worries":
      return (await worryRepo.list(userId)).length;
    case "gratitude":
      return (await gratitudeRepo.list(userId)).length;
    default:
      return 0;
  }
}
