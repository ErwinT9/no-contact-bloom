import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarCheck, Check, Clock, Lock, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { MoodCheckIn, type MoodCheckInResult } from "@/components/MoodCheckIn";
import { SoftCard } from "@/components/SoftCard";
import { SosToolkit } from "@/components/SosToolkit";
import { SubScreen } from "@/components/SubScreen";
import { Button } from "@/components/ui/button";
import { dailyExerciseRepo } from "@/data/dailyExerciseRepo";
import { moodRepo } from "@/data/repository";
import { useAuth } from "@/hooks/useAuth";
import { analytics, humanizeError } from "@/lib/analytics";
import { orderedSteps, sessionById, type ExerciseStep } from "@/lib/dailyExercise/content";
import { countFor } from "@/lib/dailyExercise/counts";
import { featureEntry, type ExerciseCountSource } from "@/lib/dailyExercise/features";
import { clearGuidedContext, setGuidedContext } from "@/lib/dailyExercise/guidedContext";
import { haptic } from "@/lib/native/haptics";
import { formatLocalDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_authenticated/daily-exercise")({
  head: () => ({
    meta: [
      { title: "Daily Guided Exercise | STEADY" },
      {
        name: "description",
        content:
          "One short guided recovery session each day, step by step, using the tools you already have.",
      },
      { property: "og:title", content: "Daily Guided Exercise | STEADY" },
      {
        property: "og:description",
        content: "Today's guided session: a few focused steps that move your healing forward.",
      },
    ],
  }),
  component: DailyExerciseScreen,
});


function StepBadge({ done, locked, index }: { done: boolean; locked: boolean; index: number }) {
  return (
    <span
      className={
        done
          ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-mint text-on-tint"
          : locked
            ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            : "flex size-8 shrink-0 items-center justify-center rounded-full bg-lavender text-on-tint"
      }
    >
      {done ? (
        <Check className="size-4" aria-hidden />
      ) : locked ? (
        <Lock className="size-3.5" aria-hidden />
      ) : (
        <span className="text-sm font-semibold">{index}</span>
      )}
    </span>
  );
}

function DailyExerciseScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [moodOpen, setMoodOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [sosTool, setSosTool] = useState<"breathe" | "ground" | "urge">("breathe");

  useEffect(() => {
    analytics.screen("daily_exercise");
    // Back on the exercise screen: the contextual "return here" strip is done.
    clearGuidedContext();
  }, []);

  const state = useQuery({
    queryKey: ["daily-exercise", userId],
    queryFn: () => dailyExerciseRepo.today(userId),
    enabled: Boolean(userId),
  });
  const history = useQuery({
    queryKey: ["daily-exercise-history", userId],
    queryFn: () => dailyExerciseRepo.history(userId),
    enabled: Boolean(userId),
  });

  const session = sessionById(state.data?.session_id);
  const steps = session ? orderedSteps(session) : [];
  const completed = state.data?.completed_steps ?? [];
  const currentStep = steps.find((step) => !completed.includes(step.order)) ?? null;
  const allDone = Boolean(session) && steps.length > 0 && currentStep === null;
  const stepNumber = currentStep ? steps.indexOf(currentStep) + 1 : steps.length;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["daily-exercise", userId] });
  }, [queryClient, userId]);

  /**
   * Completion is detected from the EXISTING feature's own saved data: when the
   * step was started we recorded that feature's row count, so a new saved entry
   * (and nothing else) completes the step. Merely opening a feature never does.
   */
  const detect = useCallback(async () => {
    if (!userId || !state.data || !currentStep) return;
    const entry = featureEntry(currentStep.feature);
    if (!entry || !("count" in entry) || !entry.count) return;
    const baseline = state.data.baselines[String(currentStep.order)];
    if (baseline === undefined) return;
    const now = await countFor(entry.count as ExerciseCountSource, userId);
    if (now <= baseline) return;
    await dailyExerciseRepo.completeStep(userId, currentStep.order);
    haptic.success();
    await refresh();
  }, [userId, state.data, currentStep, refresh]);

  useEffect(() => {
    void detect();
    const onFocus = () => void detect();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [detect]);

  const startStep = useMutation({
    mutationFn: async (step: ExerciseStep) => {
      if (!userId) return;
      const entry = featureEntry(step.feature);
      if (!entry) return;
      let baseline = 0;
      if ("count" in entry && entry.count) {
        baseline = await countFor(entry.count as ExerciseCountSource, userId);
        await dailyExerciseRepo.setBaseline(userId, step.order, baseline);
      } else {
        await dailyExerciseRepo.markOpened(userId, step.order);
      }
      await refresh();

      if (entry.kind === "mood") {
        setMoodOpen(true);
        return;
      }
      if ("sos" in entry && entry.sos) {
        setSosTool(entry.sos);
        setSosOpen(true);
        return;
      }
      if ("to" in entry && entry.to) {
        // Navigation context only: lets the existing feature offer a way back to
        // this exact session, and returns the user here on a real save.
        setGuidedContext({
          order: step.order,
          path: entry.to,
          count: "count" in entry && entry.count ? entry.count : null,
          baseline,
        });
        await navigate({ to: entry.to });
      }
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const saveMood = useMutation({
    mutationFn: async (result: MoodCheckInResult) => {
      if (!userId || !currentStep) return;
      await moodRepo.save(userId, result);
      await dailyExerciseRepo.completeStep(userId, currentStep.order);
    },
    onSuccess: async () => {
      haptic.success();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mood-today", userId] }),
        queryClient.invalidateQueries({ queryKey: ["moods", userId] }),
        refresh(),
      ]);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const confirmStep = useMutation({
    mutationFn: async (step: ExerciseStep) => {
      if (!userId) return;
      await dailyExerciseRepo.completeStep(userId, step.order);
    },
    onSuccess: async () => {
      haptic.success();
      await refresh();
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const finish = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await dailyExerciseRepo.finish(userId);
    },
    onSuccess: async () => {
      haptic.success();
      analytics.track("daily_exercise_completed", { session: session?.id ?? null });
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["daily-exercise-history", userId] }),
      ]);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  if (!session) {
    return (
      <SubScreen title="Daily Guided Exercise" description="Preparing today's session…">
        <SoftCard>
          <p className="text-sm text-muted-foreground">One moment…</p>
        </SoftCard>
      </SubScreen>
    );
  }

  const openedCurrent =
    currentStep && (state.data?.opened_steps ?? []).includes(currentStep.order);
  const currentEntry = currentStep ? featureEntry(currentStep.feature) : null;
  const isPractice = currentEntry?.kind === "practice";
  const previousStep =
    currentStep && steps.indexOf(currentStep) > 0 ? steps[steps.indexOf(currentStep) - 1] : null;

  return (
    <SubScreen title="Today's Exercise" description={session.category}>
      <SoftCard className="bg-mint">
        <p className="text-lg font-semibold text-on-tint">{session.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-on-tint/80">
          <Clock className="size-3.5" aria-hidden />
          About {session.estimated_minutes} min
        </p>
        <p className="mt-3 text-sm text-on-tint/90">{session.purpose}</p>
      </SoftCard>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.round((completed.length / steps.length) * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {completed.length}/{steps.length} steps completed
      </p>

      {allDone ? (
        <SoftCard className="mt-5 bg-lavender">
          <Sparkles className="size-5 text-on-tint" aria-hidden />
          <p className="mt-2 text-lg font-semibold text-on-tint">{session.completion.title}</p>
          <p className="mt-2 text-sm text-on-tint/90">{session.completion.message}</p>
          <p className="mt-3 text-xs text-on-tint/80">
            {steps.length}/{steps.length} steps completed
          </p>
          {state.data?.completed ? (
            <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-on-tint">
              <Check className="size-4" aria-hidden /> Session finished for today
            </p>
          ) : (
            <Button
              className="press mt-4 h-12 w-full rounded-2xl"
              disabled={finish.isPending}
              onClick={() => finish.mutate()}
            >
              Finish today's session
            </Button>
          )}
        </SoftCard>
      ) : null}

      <ul className="mt-5 space-y-3">
        {steps.map((step, index) => {
          const done = completed.includes(step.order);
          const isCurrent = currentStep?.order === step.order;
          const locked = !done && !isCurrent;
          return (
            <li key={step.order}>
              <SoftCard className={locked ? "opacity-60" : ""}>
                <div className="flex items-start gap-3">
                  <StepBadge done={done} locked={locked} index={index + 1} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs tracking-wide text-muted-foreground uppercase">
                      Step {index + 1} of {steps.length}
                    </p>
                    <p className="mt-1 font-medium">{step.title}</p>
                    {done ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Check className="size-4" aria-hidden /> Step complete
                      </p>
                    ) : null}
                    {isCurrent ? (
                      <>
                        <p className="mt-1 text-sm font-medium text-muted-foreground">
                          {previousStep ? "Unlocked — next up" : "Ready to start"}
                        </p>
                        <p className="mt-2 text-sm">{step.instruction}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{step.why}</p>
                        <Button
                          className="press mt-4 h-12 w-full rounded-2xl"
                          disabled={startStep.isPending}
                          onClick={() => {
                            haptic.light();
                            startStep.mutate(step);
                          }}
                        >
                          {currentEntry?.label ?? "Open Feature"}
                        </Button>
                        {isPractice && openedCurrent ? (
                          <Button
                            variant="secondary"
                            className="press mt-2 h-11 w-full rounded-2xl"
                            disabled={confirmStep.isPending}
                            onClick={() => confirmStep.mutate(step)}
                          >
                            I did this — mark step complete
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </SoftCard>
            </li>
          );
        })}
      </ul>

      {(history.data?.length ?? 0) > 0 ? (
        <section className="mt-7">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Previous sessions</h2>
          <ul className="mt-3 space-y-2">
            {history.data!.map((row) => (
              <li key={row.id}>
                <SoftCard className="flex items-center gap-3 p-4">
                  <CalendarCheck className="size-5 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.session_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatLocalDateTime(row.completed_at)} · {row.completed_steps}/
                      {row.total_steps} steps
                    </p>
                  </div>
                </SoftCard>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <MoodCheckIn
        open={moodOpen}
        onOpenChange={setMoodOpen}
        saving={saveMood.isPending}
        onComplete={async (result) => {
          await saveMood.mutateAsync(result);
        }}
      />
      <SosToolkit open={sosOpen} onOpenChange={setSosOpen} initialTool={sosTool} />
    </SubScreen>
  );
}
