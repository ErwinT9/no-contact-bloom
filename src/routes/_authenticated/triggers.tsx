import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ActivityListScreen } from "@/components/ActivityListScreen";
import { TriggersIllustration } from "@/components/illustrations";
import { triggerRepo } from "@/data/repository";

const importSuccessAnimation = () => import("@/components/SuccessLottieAnimation");
const SuccessLottieAnimation = lazy(importSuccessAnimation);

export const Route = createFileRoute("/_authenticated/triggers")({
  head: () => ({
    meta: [
      { title: "Triggers | SOLACE: BREAKUP RECOVERY" },
      { name: "description", content: "Name the moments that make you want to reach out." },
      { property: "og:title", content: "Triggers | SOLACE: BREAKUP RECOVERY" },
      { property: "og:description", content: "Spot your patterns so they stop catching you off guard." },
    ],
  }),
  component: () => {
    const { t } = useTranslation();
    // Warm the animation chunk so the overlay shows instantly on the first save.
    useEffect(() => {
      void importSuccessAnimation().catch(() => {});
    }, []);
    return (
      <ActivityListScreen
        title={t("triggers.title")}
        subtitle={t("triggers.subtitle")}
        illustration={<TriggersIllustration />}
        cacheKey="triggers"
        repo={triggerRepo}
        mainField="title"
        mainPlaceholder={t("triggers.mainPlaceholder")}
        noteField="note"
        notePlaceholder={t("triggers.notePlaceholder")}
        suggestions={t("triggers.suggestions", { returnObjects: true }) as string[]}
        emptyText={t("triggers.emptyText")}
        successAnimation={({ onComplete }) => (
          <Suspense fallback={null}>
            <SuccessLottieAnimation onComplete={onComplete} />
          </Suspense>
        )}
      />
    );
  },
});
