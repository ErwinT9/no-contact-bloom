import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { countFor } from "@/lib/dailyExercise/counts";
import type { ExerciseCountSource } from "@/lib/dailyExercise/features";
import {
  clearGuidedContext,
  getGuidedContext,
  subscribeGuidedContext,
  type GuidedContext,
} from "@/lib/dailyExercise/guidedContext";
import { haptic } from "@/lib/native/haptics";

/**
 * Contextual strip shown ONLY while an existing feature was opened from the
 * Daily Guided Exercise. It adds navigation around the feature — it never
 * changes the feature itself, and it is absent when the feature is opened
 * normally from anywhere else in the app.
 */
export function GuidedExerciseBar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [context, setContext] = useState<GuidedContext | null>(null);

  useEffect(() => {
    setContext(getGuidedContext());
    return subscribeGuidedContext(() => setContext(getGuidedContext()));
  }, [pathname]);

  // Route-based tools are active only on their exact destination. In-place
  // tools such as Mood Check-In use /daily-exercise as their destination and
  // remain visible above the dialog while it is open.
  const visible = Boolean(context) && context?.path === pathname;

  const returnToExercise = () => {
    haptic.light();
    clearGuidedContext();
    if (pathname === "/daily-exercise") {
      // Mood Check-In and SOS are existing dialogs on this route. Close the
      // active dialog rather than navigating to the route that is already open.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return;
    }
    void navigate({ to: "/daily-exercise" });
  };

  // Push the app content down so the strip never covers a feature's own header.
  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.paddingTop;
    document.body.style.paddingTop = "calc(env(safe-area-inset-top) + 2.75rem)";
    return () => {
      document.body.style.paddingTop = previous;
    };
  }, [visible]);

  /**
   * Watches the existing feature's OWN saved list. A brand new entry — and
   * nothing else — sends the user straight back to the guided exercise, where
   * that single step is then marked complete.
   */
  useEffect(() => {
    if (!visible || !context || !context.count || !userId) return;
    let stop = false;
    const check = async () => {
      if (stop) return;
      try {
        const now = await countFor(context.count as ExerciseCountSource, userId);
        if (!stop && now > context.baseline) {
          stop = true;
          haptic.success();
          await navigate({ to: "/daily-exercise" });
        }
      } catch {
        /* polling never interrupts the feature */
      }
    };
    const timer = window.setInterval(() => void check(), 1200);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [visible, context, userId, navigate]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 pt-[env(safe-area-inset-top)] pb-2 backdrop-blur">
      <button
        type="button"
        onClick={returnToExercise}
        className="press flex min-h-11 flex-1 items-center gap-2 rounded-xl px-2 text-left text-sm font-medium"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden />
        Back to Today's Exercise
      </button>
      <button
        type="button"
        aria-label="Leave guided exercise"
        onClick={() => {
          haptic.light();
          clearGuidedContext();
        }}
        className="press flex size-9 items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
