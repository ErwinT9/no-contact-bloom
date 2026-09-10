import { useQuery } from "@tanstack/react-query";
import { CircleDot, Flag as FlagIcon, Flame, Mail, Sparkles, Trophy, Wind } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { SoftCard } from "@/components/SoftCard";
import { PopIt } from "@/components/PopIt";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { flagRepo, letterRepo, winRepo } from "@/data/repository";
import { useAuth } from "@/hooks/useAuth";
import { analytics } from "@/lib/analytics";
import { activity } from "@/lib/badgeActivity";
import { GROUNDING_STEPS } from "@/lib/content";
import { getRotatingQuote, rotationSlot } from "@/lib/dailyQuote";
import { haptic } from "@/lib/native/haptics";
import { sosEncouragement } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type Tool = "menu" | "breathe" | "ground" | "flags" | "wins" | "letters" | "words" | "urge";

function useCountdown(seconds: number, active: boolean) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!active) return;
    setLeft(seconds);
    const id = window.setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [active, seconds]);
  return left;
}

export function SosToolkit({
  open,
  onOpenChange,
  initialTool,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Optional deep-open, used by the Daily Guided Exercise mapping layer. */
  initialTool?: Tool;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [tool, setTool] = useState<Tool>("menu");

  const HEADERS: Record<Tool, { title: string; subtitle: string }> = {
    menu: { title: t("sos.menuTitle"), subtitle: t("sos.menuSubtitle") },
    breathe: { title: t("sos.breatheTitle"), subtitle: t("sos.breatheSubtitle") },
    ground: { title: t("sos.groundTitle"), subtitle: t("sos.groundSubtitle") },
    flags: { title: t("sos.flagsTitle"), subtitle: t("sos.flagsSubtitle") },
    wins: { title: t("sos.winsTitle"), subtitle: t("sos.winsSubtitle") },
    letters: { title: t("sos.lettersTitle"), subtitle: t("sos.lettersSubtitle") },
    words: { title: t("sos.wordsTitle"), subtitle: t("sos.wordsSubtitle") },
    urge: { title: t("sos.urgeTitle"), subtitle: t("sos.urgeSubtitle") },
  };

  const navigate = useNavigate();

  const MENU: {
    key: Tool | "motivation";
    label: string;
    hint: string;
    icon: typeof Wind;
    tint: string;
  }[] = [
    { key: "breathe", label: t("sos.breathe"), hint: t("sos.breatheHint"), icon: Wind, tint: "bg-sky" },
    { key: "ground", label: t("sos.ground"), hint: t("sos.groundHint"), icon: Sparkles, tint: "bg-lavender" },
    { key: "flags", label: t("sos.flags"), hint: t("sos.flagsHint"), icon: FlagIcon, tint: "bg-coral" },
    { key: "wins", label: t("sos.wins"), hint: t("sos.winsHint"), icon: Trophy, tint: "bg-mint" },
    { key: "letters", label: t("sos.letters"), hint: t("sos.lettersHint"), icon: Mail, tint: "bg-lavender" },
    { key: "urge", label: t("sos.urge"), hint: t("sos.urgeHint"), icon: CircleDot, tint: "bg-mint" },
    {
      key: "motivation",
      label: "Healing Tools",
      hint: "Tools to help you recover fast.",
      icon: Flame,
      tint: "bg-mint",
    },
  ];

  useEffect(() => {
    if (open) {
      setTool(initialTool ?? "menu");
      analytics.track("sos_opened");
      void sosEncouragement();
      activity.sosOpened();
      activity.featureUsed("sos");
    }
  }, [open, initialTool]);

  const flags = useQuery({
    queryKey: ["flags", userId],
    queryFn: () => flagRepo.list(userId),
    enabled: Boolean(userId) && open,
  });
  const wins = useQuery({
    queryKey: ["wins", userId],
    queryFn: () => winRepo.list(userId),
    enabled: Boolean(userId) && open,
  });
  const letters = useQuery({
    queryKey: ["letters", userId],
    queryFn: () => letterRepo.list(userId),
    enabled: Boolean(userId) && open,
  });

  const breatheLeft = useCountdown(60, open && tool === "breathe");
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setQuote(getRotatingQuote());
    let slot = rotationSlot();
    const check = () => {
      const now = rotationSlot();
      if (now === slot) return;
      slot = now;
      setQuote(getRotatingQuote());
    };
    const id = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", check);
    };
  }, [open]);

  const header = HEADERS[tool];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border-0 bg-background pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        <SheetHeader className="px-1 text-left">
          <SheetTitle className="animate-fade-in text-2xl" key={header.title}>
            {header.title}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{header.subtitle}</p>
        </SheetHeader>

        {tool !== "menu" ? (
          <Button
            variant="ghost"
            className="press mt-2 w-fit rounded-2xl"
            onClick={() => {
              haptic.select();
              setTool("menu");
            }}
          >
            {t("sos.allTools")}
          </Button>
        ) : null}

        <div className="mt-3 space-y-3">
          {tool === "menu" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {MENU.map(({ key, label, hint, icon: Icon, tint }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      haptic.light();
                      if (key === "motivation") {
                        onOpenChange(false);
                        void navigate({ to: "/healing-tools" });
                        return;
                      }
                      setTool(key);
                    }}
                    className={cn(
                      "press rounded-3xl p-4 text-left text-on-tint",
                      tint,
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    <p className="mt-2 font-semibold">{label}</p>
                    <p className="text-xs opacity-70">{hint}</p>
                  </button>
                ))}
              </div>
              <SoftCard className="bg-mint">
                <p className="text-sm font-semibold">{t("sos.dontText")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("sos.dontTextBody")}</p>
              </SoftCard>
            </>
          ) : null}

          {tool === "breathe" ? (
            <SoftCard className="flex flex-col items-center py-10">
              <div className="animate-breathe flex size-40 items-center justify-center rounded-full bg-mint">
                <span className="text-sm font-medium text-on-tint">
                  {breatheLeft % 8 < 4 ? t("sos.breatheIn") : t("sos.breatheOut")}
                </span>
              </div>
              <p className="mt-6 text-3xl font-semibold tabular-nums">{breatheLeft}s</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("sos.breatheFollow")}</p>
            </SoftCard>
          ) : null}

          {tool === "ground" ? (
            <div className="space-y-3">
              {GROUNDING_STEPS.map((step) => (
                <SoftCard key={step.sense} className="flex items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lavender text-lg font-semibold text-on-tint">
                    {step.count}
                  </span>
                  <div>
                    <p className="font-medium">{step.sense}</p>
                    <p className="text-sm text-muted-foreground">{step.hint}</p>
                  </div>
                </SoftCard>
              ))}
            </div>
          ) : null}

          {tool === "flags" ? (
            <div className="space-y-3">
              {(flags.data ?? []).length === 0 ? (
                <SoftCard>
                  <p className="text-sm text-muted-foreground">{t("sos.noFlagsYet")}</p>
                </SoftCard>
              ) : (
                (flags.data ?? []).map((flag) => (
                  <SoftCard key={flag.id} className="bg-coral">
                    <p className="font-medium">{flag.title}</p>
                    {flag.note ? <p className="mt-1 text-sm opacity-75">{flag.note}</p> : null}
                  </SoftCard>
                ))
              )}
            </div>
          ) : null}

          {tool === "wins" ? (
            <div className="space-y-3">
              {(wins.data ?? []).length === 0 ? (
                <SoftCard>
                  <p className="text-sm text-muted-foreground">{t("sos.noWinsYet")}</p>
                </SoftCard>
              ) : (
                (wins.data ?? []).map((win) => (
                  <SoftCard key={win.id} className="bg-mint">
                    <p className="font-medium">{win.title}</p>
                    <p className="mt-1 text-xs opacity-70">{win.achieved_on}</p>
                  </SoftCard>
                ))
              )}
            </div>
          ) : null}

          {tool === "letters" ? (
            <div className="space-y-3">
              {(letters.data ?? []).length === 0 ? (
                <SoftCard>
                  <p className="text-sm text-muted-foreground">{t("sos.noLettersYet")}</p>
                </SoftCard>
              ) : (
                (letters.data ?? []).map((letter) => (
                  <SoftCard key={letter.id}>
                    <p className="font-medium">{letter.title ?? t("sos.untitledLetter")}</p>
                    <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{letter.body}</p>
                  </SoftCard>
                ))
              )}
            </div>
          ) : null}

          {tool === "urge" ? (
            <SoftCard className="py-4">
              <PopIt onDone={() => onOpenChange(false)} />
            </SoftCard>
          ) : null}

          {tool === "menu" && quote ? (
            <SoftCard className="bg-sky">
              <p className="animate-fade-in text-sm italic text-on-tint">“{quote}”</p>
            </SoftCard>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
