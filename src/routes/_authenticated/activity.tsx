import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  Camera,
  Flame,
  HeartHandshake,
  Repeat,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { DailyExerciseCard } from "@/components/DailyExerciseCard";
import { SoftCard } from "@/components/SoftCard";
import { Button } from "@/components/ui/button";
import {
  affirmationRepo,
  journalRepo,
  localDayKey,
  pictureRepo,
  promiseRepo,
  ritualRepo,
  triggerRepo,
} from "@/data/repository";
import { useAuth } from "@/hooks/useAuth";
import { humanizeError } from "@/lib/analytics";
import { celebrate } from "@/lib/celebrate";
import { haptic } from "@/lib/native/haptics";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "Activity workbook | SOLACE: BREAKUP RECOVERY" },
      {
        name: "description",
        content: "Your workbook: pictures, journal, triggers, rituals and affirmations.",
      },
      { property: "og:title", content: "Activity workbook | SOLACE: BREAKUP RECOVERY" },
      {
        property: "og:description",
        content: "Daily recovery work in one calm place — track it, don't just feel it.",
      },
    ],
  }),
  component: Activity,
});

const QUICK_ACTIONS = [
  {
    to: "/pictures",
    icon: Camera,
    titleKey: "activity.quick.pictures.title",
    bodyKey: "activity.quick.pictures.body",
    tint: "bg-mint",
  },
  {
    to: "/journal",
    icon: BookOpen,
    titleKey: "activity.quick.journal.title",
    bodyKey: "activity.quick.journal.body",
    tint: "bg-sky",
  },
  {
    to: "/triggers",
    icon: TriangleAlert,
    titleKey: "activity.quick.triggers.title",
    bodyKey: "activity.quick.triggers.body",
    tint: "bg-blush",
  },
  {
    to: "/rituals",
    icon: Repeat,
    titleKey: "activity.quick.rituals.title",
    bodyKey: "activity.quick.rituals.body",
    tint: "bg-sand",
  },
  {
    to: "/affirmations",
    icon: Sparkles,
    titleKey: "activity.quick.affirmations.title",
    bodyKey: "activity.quick.affirmations.body",
    tint: "bg-mint",
  },
] as const;

function Activity() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();

  const enabled = Boolean(userId);
  const pictures = useQuery({
    queryKey: ["pictures", userId],
    queryFn: () => pictureRepo.list(userId),
    enabled,
  });
  const journal = useQuery({
    queryKey: ["journal", userId],
    queryFn: () => journalRepo.list(userId),
    enabled,
  });
  const triggers = useQuery({
    queryKey: ["triggers", userId],
    queryFn: () => triggerRepo.list(userId),
    enabled,
  });
  const rituals = useQuery({
    queryKey: ["rituals", userId],
    queryFn: () => ritualRepo.list(userId),
    enabled,
  });
  const affirmations = useQuery({
    queryKey: ["affirmations", userId],
    queryFn: () => affirmationRepo.list(userId),
    enabled,
  });
  const promises = useQuery({
    queryKey: ["promises", userId],
    queryFn: () => promiseRepo.list(userId),
    enabled,
  });

  const today = localDayKey();
  const promisedToday = (promises.data ?? []).some((row) => row.promised_on === today);

  const promise = useMutation({
    mutationFn: () => promiseRepo.makeToday(userId),
    onSuccess: (rows) => {
      queryClient.setQueryData(["promises", userId], rows);
      haptic.success();
      void celebrate();
      toast.success(t("activity.promiseMade"));
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const counters = [
    { label: t("activity.counters.pictures"), value: pictures.data?.length ?? 0, icon: Camera },
    { label: t("activity.counters.journal"), value: journal.data?.length ?? 0, icon: BookOpen },
    { label: t("activity.counters.triggers"), value: triggers.data?.length ?? 0, icon: TriangleAlert },
    { label: t("activity.counters.rituals"), value: rituals.data?.length ?? 0, icon: Repeat },
    { label: t("activity.counters.affirmations"), value: affirmations.data?.length ?? 0, icon: Sparkles },
  ];

  return (
    <AppShell title={t("activity.title")} subtitle={t("activity.subtitle")}>
      <section aria-labelledby="overview">
        <h2 id="overview" className="px-1 text-sm font-medium text-muted-foreground">
          {t("activity.overview")}
        </h2>
        <ul className="mt-3 grid grid-cols-3 gap-3">
          {counters.map(({ label, value, icon: Icon }) => (
            <SoftCard as="li" key={label} className="p-4 text-center">
              <Icon className="mx-auto size-5 text-primary" aria-hidden />
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </SoftCard>
          ))}
        </ul>
      </section>

      <Link
        to="/motivation"
        onClick={() => haptic.select()}
        className="press soft-card mt-5 flex items-start gap-3 rounded-3xl bg-mint p-5"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-background/40">
          <Flame className="size-5 text-on-tint" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-on-tint">Journey</span>
          <span className="mt-1 block text-sm text-on-tint/80">
            Small steps to help you heal, grow, and reconnect with yourself.
          </span>
        </span>
      </Link>

      <div className="mt-3">
        <DailyExerciseCard />
      </div>

      <Link
        to="/healing-tools"
        onClick={() => haptic.select()}
        className="press soft-card mt-3 flex items-start gap-3 rounded-3xl bg-lavender p-5"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-background/40">
          <HeartHandshake className="size-5 text-on-tint" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-on-tint">Healing Tools</span>
          <span className="mt-1 block text-sm text-on-tint/80">
            A little reminder to keep choosing yourself.
          </span>
        </span>
      </Link>

      <SoftCard className="mt-5 bg-mint">
        <div className="flex items-start gap-3">
          <HeartHandshake className="mt-0.5 size-5 text-on-tint" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-on-tint">{t("activity.todaysPromise")}</p>
            <p className="mt-1 text-sm text-on-tint/80">
              {promisedToday
                ? t("activity.promisedTodayMsg")
                : t("activity.promiseCta")}
            </p>
            {promisedToday ? null : (
              <Button
                className="press mt-3 h-11 w-full rounded-2xl"
                disabled={promise.isPending}
                onClick={() => promise.mutate()}
              >
                {t("activity.iPromise")}
              </Button>
            )}
          </div>
        </div>
      </SoftCard>

      <section aria-labelledby="quick" className="mt-6">
        <h2 id="quick" className="px-1 text-sm font-medium text-muted-foreground">
          {t("activity.quickActions")}
        </h2>
        <ul className="mt-3 space-y-3">
          {QUICK_ACTIONS.map(({ to, icon: Icon, titleKey, bodyKey, tint }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={() => haptic.select()}
                className="press soft-card flex items-center gap-4 rounded-3xl p-4"
              >
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${tint}`}
                >
                  <Icon className="size-5 text-on-tint" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(titleKey)}</span>
                  <span className="block text-sm text-muted-foreground">{t(bodyKey)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
