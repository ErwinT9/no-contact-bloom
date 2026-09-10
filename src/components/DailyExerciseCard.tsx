import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ListChecks } from "lucide-react";

import { SoftCard } from "@/components/SoftCard";
import { dailyExerciseRepo } from "@/data/dailyExerciseRepo";
import { useAuth } from "@/hooks/useAuth";
import { orderedSteps, sessionById } from "@/lib/dailyExercise/content";
import { haptic } from "@/lib/native/haptics";

/**
 * Shared entry point for the Daily Guided Exercise (Home + Activity).
 * Both render this card, so both open the exact same persisted daily state.
 */
export function DailyExerciseCard() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const state = useQuery({
    queryKey: ["daily-exercise", userId],
    queryFn: () => dailyExerciseRepo.today(userId),
    enabled: Boolean(userId),
  });

  const session = sessionById(state.data?.session_id);
  const total = session ? orderedSteps(session).length : 0;
  const done = state.data?.completed_steps.length ?? 0;
  const finished = Boolean(state.data?.completed);

  return (
    <Link to="/daily-exercise" className="press block" onClick={() => haptic.select()}>
      <SoftCard className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky">
          <ListChecks className="size-5 text-on-tint" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Daily Guided Exercise</p>
          <p className="truncate text-sm text-muted-foreground">
            {session ? session.title : "Today's guided session"}
          </p>
          {total > 0 ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {finished ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
              {finished ? "Completed today" : `${done}/${total} steps completed`}
            </p>
          ) : null}
        </div>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </SoftCard>
    </Link>
  );
}
