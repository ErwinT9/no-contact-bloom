import type { PluginListenerHandle } from "@capacitor/core";

import { clearGuidedContext, getGuidedContext } from "@/lib/dailyExercise/guidedContext";

import { isNative } from "./platform";

/** Screens that act as a root destination: back here should background the app. */
const ROOT_PATHS = new Set(["/", "/home", "/auth"]);

/** Closes the topmost Radix overlay (dialog/drawer/sheet), if one is open. */
function closeTopOverlay(): boolean {
  const overlay = document.querySelector(
    "[data-state='open'][role='dialog'], [data-state='open'][role='alertdialog']",
  );
  if (!overlay) return false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return true;
}

/**
 * Android hardware back button + back gesture.
 * - Overlay open -> close it.
 * - Inside the app -> go back one screen.
 * - On Home (or auth/splash) -> minimize the app, never return to the splash.
 */
export function initAndroidBackButton(
  navigateHome: () => void,
  navigateToExercise: () => void,
): () => void {
  if (!isNative()) return () => {};

  let handle: PluginListenerHandle | undefined;
  let cancelled = false;

  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const listener = await App.addListener("backButton", () => {
        const guided = getGuidedContext();
        if (guided) {
          clearGuidedContext();
          if (window.location.pathname === "/daily-exercise") {
            closeTopOverlay();
          } else {
            navigateToExercise();
          }
          return;
        }

        if (closeTopOverlay()) return;

        const path = window.location.pathname;
        if (ROOT_PATHS.has(path)) {
          void App.minimizeApp();
          return;
        }

        if (window.history.length > 1) {
          window.history.back();
        } else {
          navigateHome();
        }
      });
      if (cancelled) void listener.remove();
      else handle = listener;
    } catch (error) {
      console.warn("[native] back button listener failed", error);
    }
  })();

  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
