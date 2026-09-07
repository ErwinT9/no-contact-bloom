import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { SoftCard } from "@/components/SoftCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { humanizeError } from "@/lib/analytics";
import { activity, TRACKED_FEATURES } from "@/lib/badgeActivity";
import { haptic } from "@/lib/native/haptics";

type Row = { id: string; created_at: string } & Record<string, unknown>;

export type SimpleRepo = {
  list: (userId: string) => Promise<Row[]>;
  save: (userId: string, input: Record<string, unknown>) => Promise<Row[]>;
  remove: (userId: string, id: string) => Promise<Row[]>;
};

export function ActivityListScreen({
  title,
  subtitle,
  cacheKey,
  repo,
  mainField,
  mainPlaceholder,
  noteField,
  notePlaceholder,
  multiline = false,
  suggestions = [],
  emptyText,
  illustration,
  successAnimation,
}: {
  title: string;
  subtitle: string;
  cacheKey: string;
  repo: SimpleRepo;
  mainField: string;
  mainPlaceholder: string;
  noteField?: string;
  notePlaceholder?: string;
  multiline?: boolean;
  suggestions?: string[];
  emptyText: string;
  illustration?: ReactNode;
  /**
   * Optional Lottie/animation renderer shown centered on screen after a
   * successful save. When provided, a full-screen overlay is rendered on every
   * successful add and dismissed as soon as the animation reports completion.
   */
  successAnimation?: (options: { onComplete: () => void }) => ReactNode;

}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [main, setMain] = useState("");
  const [note, setNote] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successKey, setSuccessKey] = useState(0);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  // Block page scrolling (and rubber-banding on mobile) while the overlay plays.
  useEffect(() => {
    if (!showSuccess) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [showSuccess]);


  const items = useQuery({
    queryKey: [cacheKey, userId],
    queryFn: () => repo.list(userId),
    enabled: Boolean(userId),
  });

  const add = useMutation({
    mutationFn: async (value: string) => {
      const payload: Record<string, unknown> = { [mainField]: value };
      if (noteField && note.trim()) payload[noteField] = note.trim();
      return repo.save(userId, payload);
    },
    onSuccess: (rows) => {
      // Trigger the success overlay first so no side effect below can throw
      // before the animation state is set.
      if (successAnimation) {
        setShowSuccess(true);
        // Remount the animation so every save replays it from the start.
        setSuccessKey((value) => value + 1);
        if (successTimer.current) clearTimeout(successTimer.current);
        // Safety net in case the animation never reports completion.
        successTimer.current = setTimeout(() => setShowSuccess(false), 8000);
      }

      setMain("");
      setNote("");
      queryClient.setQueryData([cacheKey, userId], rows);
      try {
        if ((TRACKED_FEATURES as readonly string[]).includes(cacheKey)) {
          activity.featureUsed(cacheKey as (typeof TRACKED_FEATURES)[number]);
        }
      } catch {
        /* badge tracking must never block the success animation */
      }
      try {
        haptic.success();
      } catch {
        /* haptics are best-effort */
      }
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => repo.remove(userId, id),
    onSuccess: (rows) => queryClient.setQueryData([cacheKey, userId], rows),
  });

  const list = items.data ?? [];

  return (
    <AppShell title={title} subtitle={subtitle}>
      {illustration ? <div className="mx-auto mb-5 mt-1 w-40">{illustration}</div> : null}
      <SoftCard className="space-y-3">
        {multiline ? (
          <Textarea
            value={main}
            onChange={(event) => setMain(event.target.value)}
            placeholder={mainPlaceholder}
            className="min-h-28 rounded-2xl"
          />
        ) : (
          <Input
            value={main}
            onChange={(event) => setMain(event.target.value)}
            placeholder={mainPlaceholder}
            className="h-12 rounded-2xl"
          />
        )}
        {noteField ? (
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={notePlaceholder ?? t("activityList.addNoteOptional")}
            className="h-12 rounded-2xl"
          />
        ) : null}
        <Button
          className="press h-12 w-full rounded-2xl"
          disabled={!main.trim() || add.isPending}
          onClick={() => add.mutate(main.trim())}
        >
          {t("activityList.add")}
        </Button>
      </SoftCard>

      {suggestions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                haptic.select();
                add.mutate(suggestion);
              }}
              className="press rounded-full border border-border bg-card px-4 py-2 text-sm"
            >
              {suggestion}
            </button>
          ))}
        </div>,
            document.body,
          )
        : null}

      <ul className="mt-5 space-y-3">
        {list.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{emptyText}</p>
        ) : null}
        {list.map((item) => (
          <SoftCard as="li" key={item.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words whitespace-pre-wrap">
                {String(item[mainField] ?? "")}
              </p>
              {noteField && item[noteField] ? (
                <p className="mt-1 text-sm text-muted-foreground break-words">
                  {String(item[noteField])}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("activityList.delete")}
              onClick={() => {
                haptic.light();
                remove.mutate(item.id);
              }}
              className="press mt-0.5 text-muted-foreground"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </SoftCard>
        ))}
      </ul>

      {showSuccess && successAnimation && typeof document !== "undefined"
        ? createPortal(
        <div
          role="status"
          aria-live="polite"
          style={{ zIndex: 2147483647 }}
          className="fixed inset-0 flex items-center justify-center overflow-hidden bg-background/85 p-8 backdrop-blur-md animate-fade-in dark:bg-background/90"
          onPointerDown={(event) => event.preventDefault()}
          onTouchMove={(event) => event.preventDefault()}
        >
          <div key={successKey} className="flex items-center justify-center">
            {successAnimation({ onComplete: () => setShowSuccess(false) })}
          </div>

        </div>,
            document.body,
          )
        : null}

    </AppShell>
  );
}
