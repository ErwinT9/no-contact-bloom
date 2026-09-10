import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, BarChart3, Compass, HeartHandshake, Mail, Sparkles, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { Crown } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { DailyExerciseCard } from "@/components/DailyExerciseCard";
import { DailyTasks } from "@/components/DailyTasks";
import { FireflyJar } from "@/components/FireflyJar";
import { HealingProgress } from "@/components/HealingProgress";
import { SoftCard } from "@/components/SoftCard";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  flagRepo,
  letterRepo,
  moodRepo,
  profileRepo,
  streakRepo,
  winRepo,
} from "@/data/repository";
import { MoodCheckIn, type MoodCheckInResult } from "@/components/MoodCheckIn";
import { useAuth } from "@/hooks/useAuth";
import { useRotatingHomeQuote } from "@/hooks/useDailyQuote";
import { analytics, humanizeError } from "@/lib/analytics";
import { activity } from "@/lib/badgeActivity";
import { celebrate } from "@/lib/celebrate";
import { actionByKey, BADGES, moodByKey } from "@/lib/content";
import { useBadges } from "@/hooks/useBadges";
import { haptic } from "@/lib/native/haptics";
import { DAILY_MOOD_LIMIT, categoryMeta, moodCategory } from "@/lib/mood";
import { celebrateMilestone } from "@/lib/notifications";
import { daysSince, elapsedSince } from "@/lib/streak";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your streak | SOLACE: BREAKUP RECOVERY" },
      {
        name: "description",
        content: "Watch your no-contact streak grow second by second and see your next milestone.",
      },
      { property: "og:title", content: "Your streak | SOLACE: BREAKUP RECOVERY" },
      { property: "og:description", content: "Every second here is a second you didn't reach out." },
    ],
  }),
  component: HomeScreen,
});

function useTick(intervalMs = 1000) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-semibold tabular-nums">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

/** Display-only capitalization of the stored display name. */
function capitalizeName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useTick();
  const rotatingQuote = useRotatingHomeQuote();

  useEffect(() => {
    analytics.screen("home");
  }, []);

  const profile = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => profileRepo.get(userId),
    enabled: Boolean(userId),
  });
  const streak = useQuery({
    queryKey: ["streak", userId],
    queryFn: () => streakRepo.ensure(userId),
    enabled: Boolean(userId),
  });
  const flags = useQuery({
    queryKey: ["flags", userId],
    queryFn: () => flagRepo.list(userId),
    enabled: Boolean(userId),
  });
  const wins = useQuery({
    queryKey: ["wins", userId],
    queryFn: () => winRepo.list(userId),
    enabled: Boolean(userId),
  });
  const letters = useQuery({
    queryKey: ["letters", userId],
    queryFn: () => letterRepo.list(userId),
    enabled: Boolean(userId),
  });
  const todayMoods = useQuery({
    queryKey: ["mood-today", userId],
    queryFn: () => moodRepo.todayEntries(userId),
    enabled: Boolean(userId),
  });

  const [checkInOpen, setCheckInOpen] = useState(false);

  // Deep link from the Evening Reminder notification (/check-in -> /home?checkin=1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkin") !== "1") return;
    setCheckInOpen(true);
    params.delete("checkin");
    const query = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
  }, []);

  const saveCheckIn = useMutation({
    mutationFn: async (result: MoodCheckInResult) => {
      if (!userId) return;
      await moodRepo.save(userId, result);
    },
    onSuccess: async () => {
      analytics.track("mood_checkin_saved");
      activity.featureUsed("mood");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mood-today", userId] }),
        queryClient.invalidateQueries({ queryKey: ["moods", userId] }),
      ]);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const todayEntries = todayMoods.data ?? [];
  const checkin = todayEntries[0] ?? null;
  const checkinMood = moodByKey(checkin?.mood);
  const checkinAction = actionByKey(checkin?.action);
  const limitReached = todayEntries.length >= DAILY_MOOD_LIMIT;

  useEffect(() => {
    if (profile.isLoading || profile.isFetching || !profile.data) return;
    if (!profile.data.questionnaire_completed) void navigate({ to: "/questionnaire" });
  }, [profile.isLoading, profile.isFetching, profile.data, navigate]);

  const startedAt = streak.data?.started_at;
  const elapsed = elapsedSince(startedAt ?? new Date().toISOString());
  const days = startedAt ? daysSince(startedAt) : 0;

  // Share of the current calendar day that has passed — drives the firefly jar.
  const now = new Date();
  const dayProgress =
    (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;

  // Central badge engine: gathers every stat, unlocks and toasts automatically.
  const badgeState = useBadges({ autoUnlock: true });

  const reset = useMutation({
    mutationFn: async () => {
      if (!userId || !streak.data) return;
      await streakRepo.reset(userId, streak.data, days);
    },
    onSuccess: async () => {
      haptic.warning();
      analytics.track("streak_reset", { days });
      toast(t("home.streakResetToast"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["streak", userId] }),
        queryClient.invalidateQueries({ queryKey: ["badges", userId] }),
        queryClient.invalidateQueries({ queryKey: ["wins", userId] }),
        queryClient.invalidateQueries({ queryKey: ["flags", userId] }),
      ]);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const milestoneHit = BADGES.find((badge) => badge.days === days);
  useEffect(() => {
    if (!milestoneHit || days === 0) return;
    const key = `nc:milestone:${milestoneHit.key}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    void celebrate();
    void celebrateMilestone(milestoneHit.label);
  }, [milestoneHit, days]);

  const rawName = profile.data?.display_name;
  const name = rawName ? capitalizeName(rawName) : "";
  const { isPremium } = useSubscription();

  return (
    <AppShell
      title={name ? t("home.greeting", { name }) : t("home.welcome")}
      action={
        <button
          type="button"
          aria-label={isPremium ? "Pro active" : "Upgrade to Pro"}
          onClick={() => {
            haptic.light();
            void navigate({ to: "/paywall" });
          }}
          className={
            isPremium
              ? "press flex h-10 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              : "press flex h-10 shrink-0 items-center gap-1 rounded-full bg-lavender px-3 text-xs font-semibold tracking-wide text-on-tint uppercase shadow-sm"
          }
        >
          <Crown className="size-4" aria-hidden />
          Pro
        </button>
      }
    >
      <div className="space-y-4">
        <SoftCard className="bg-mint px-5 py-3 text-center">
          <FireflyJar days={elapsed.days} dailyProgress={dayProgress} />
          <div className="mt-1 flex items-center justify-center gap-6 text-on-tint">
            <Unit value={elapsed.hours} label={t("home.hrs")} />
            <Unit value={elapsed.minutes} label={t("home.min")} />
            <Unit value={elapsed.seconds} label={t("home.sec")} />
          </div>
        </SoftCard>

        <HealingProgress startedAt={startedAt} bestDays={streak.data?.best_days ?? 0} />

        <DailyTasks />

        <DailyExerciseCard />

        <Link to="/motivation" className="press block">
          <SoftCard className="flex items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lavender">
              <Compass className="size-5 text-on-tint" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Track Your Journey</p>
              <p className="text-sm text-muted-foreground">
                Journey, Goals & Routines to help you move forward.
              </p>
            </div>
            <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </SoftCard>
        </Link>

        <Link to="/healing-tools" className="press block">
          <SoftCard className="flex items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-mint">
              <Wrench className="size-5 text-on-tint" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Healing Tools</p>
              <p className="text-sm text-muted-foreground">
                Guides & other tools to help you reset.
              </p>
            </div>
            <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </SoftCard>
        </Link>

        <div className="grid grid-cols-3 gap-3">
          <Link to="/flags" className="press">
            <SoftCard className="bg-coral h-full text-center">
              <p className="text-2xl font-semibold text-on-tint">{flags.data?.length ?? 0}</p>
              <p className="text-xs text-on-tint/70">{t("nav.flags")}</p>
            </SoftCard>
          </Link>
          <Link to="/wins" className="press">
            <SoftCard className="bg-mint h-full text-center">
              <p className="text-2xl font-semibold text-on-tint">{wins.data?.length ?? 0}</p>
              <p className="text-xs text-on-tint/70">{t("nav.wins")}</p>
            </SoftCard>
          </Link>
          <Link to="/badges" className="press">
            <SoftCard className="bg-lavender h-full text-center">
              <p className="text-2xl font-semibold text-on-tint">
                {badgeState.unlockedCount}
              </p>
              <p className="text-xs text-on-tint/70">{t("nav.badges")}</p>
            </SoftCard>
          </Link>
        </div>

        <Link to="/letters" className="press block">
          <SoftCard className="flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-full bg-lavender">
              <Mail className="size-5 text-on-tint" aria-hidden />
            </span>
            <div className="flex-1">
              <p className="font-medium">{t("home.unsentLetters")}</p>
              <p className="text-sm text-muted-foreground">
                {t("home.unsentLettersDesc")}
              </p>
            </div>
            <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
          </SoftCard>
        </Link>

        <SoftCard className="bg-sky">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-5 text-on-tint" aria-hidden />
            <p key={rotatingQuote} className="animate-fade-in text-sm text-on-tint">
              {rotatingQuote}
            </p>
          </div>
        </SoftCard>


        <SoftCard className="animate-rise space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lavender">
                <HeartHandshake className="size-5 text-on-tint" aria-hidden />
              </span>
              <div>
                <p className="font-medium">Mood Check-In</p>
                <p className="text-sm text-muted-foreground">{t("home.pauseForMinute")}</p>
              </div>
            </div>
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="press shrink-0 rounded-2xl"
            >
              <Link to="/mood-analytics">
                <BarChart3 className="size-4" aria-hidden /> Analytics
              </Link>
            </Button>
          </div>

          {checkin ? (
            <div className="rounded-2xl border border-border p-3">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("home.todaysMood")}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  <span aria-hidden>{checkinMood?.emoji ?? "🫶"}</span>{" "}
                  {checkinMood?.label ?? checkin.mood}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs text-on-tint ${categoryMeta(moodCategory(checkin.mood)).chip}`}
                >
                  {categoryMeta(moodCategory(checkin.mood)).label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(checkin.completed_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {checkinAction ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span aria-hidden>{checkinAction.emoji}</span> {checkinAction.label}
                </p>
              ) : null}
              {checkin.custom_intention ? (
                <p className="mt-1 text-sm text-muted-foreground">{checkin.custom_intention}</p>
              ) : null}
            </div>
          ) : null}

          {limitReached ? (
            <p className="text-sm text-muted-foreground">You've reached today's mood limit.</p>
          ) : null}

          <Button
            className="press h-12 w-full rounded-2xl"
            disabled={limitReached}
            onClick={() => {
              haptic.light();
              setCheckInOpen(true);
            }}
          >
            {checkin ? "Log another mood" : t("home.checkInBtn")}
          </Button>
        </SoftCard>

        <MoodCheckIn
          open={checkInOpen}
          onOpenChange={setCheckInOpen}
          saving={saveCheckIn.isPending}
          onComplete={async (result) => {
            await saveCheckIn.mutateAsync(result);
          }}
        />

        <div className="space-y-2 pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={reset.isPending}
                className="press h-12 w-full rounded-2xl"
                onClick={() => haptic.light()}
              >
                <AlertTriangle className="size-4" aria-hidden />{t("home.iBrokeNoContact")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-3xl">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("home.resetDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("home.resetDialogDescPart1")}{" "}
                  {t("home.resetDialogDescPart2", { days: Math.max(streak.data?.best_days ?? 0, days) })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-2xl">{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => reset.mutate()}
                >
                  {t("home.yesResetStreak")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="text-center text-xs text-muted-foreground">{t("home.resetsToDay0")}</p>
        </div>
      </div>
    </AppShell>
  );
}
