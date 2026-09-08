import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { PermissionsProvider } from "@/components/PermissionsProvider";
import { AuthProvider } from "@/hooks/useAuth";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { analytics, installGlobalErrorHandlers } from "@/lib/analytics";
import { featureForPath, initCrashlytics, setScreen } from "@/lib/monitoring/crashlytics";
import { initInAppMessaging } from "@/lib/monitoring/inAppMessaging";
import {
  initPerformance,
  instrumentWebViewRequests,
  markAppReady,
} from "@/lib/monitoring/performance";
import { migrateAppState } from "@/lib/appState/migrate";
import { initNativeOAuthListeners } from "@/lib/auth/oauthNative";
import { goToResetPassword, setRecoveryNavigator } from "@/lib/auth/passwordRecovery";
import { supabase } from "@/integrations/supabase/client";
import { initAndroidBackButton } from "@/lib/native/backButton";
import { setPushNavigator } from "@/lib/notifications/push";
import { hideNativeSplash } from "@/lib/native/splash";
import { initTheme } from "@/lib/theme";
import i18n from "@/lib/i18n";
import { startNetworkWatcher, subscribeNetwork } from "@/lib/offline/network";

import { flushQueue, startSyncEngine } from "@/lib/offline/syncQueue";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
      },
      { title: "SOLACE: BREAKUP RECOVERY" },
      {
        name: "description",
        content:
          "Track your no-contact streak in real time, log red flags and wins, unlock badges and get through urges with an offline emergency toolkit.",
      },
      { name: "theme-color", content: "#FFFFFF" },
      { property: "og:title", content: "SOLACE: BREAKUP RECOVERY" },
      {
        property: "og:description",
        content: "Track your no-contact streak in real time, log red flags and wins, unlock badges and get through urges with an offline emergency toolkit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "SOLACE: BREAKUP RECOVERY" },
      { name: "twitter:description", content: "Track your no-contact streak in real time, log red flags and wins, unlock badges and get through urges with an offline emergency toolkit." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/09c55532-15bf-4dfc-ae3c-926e93cedb76/id-preview-a4956b79--1f48a9cf-2fb9-4a24-8daa-3aa382205a78.lovable.app-1785828429999.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/09c55532-15bf-4dfc-ae3c-926e93cedb76/id-preview-a4956b79--1f48a9cf-2fb9-4a24-8daa-3aa382205a78.lovable.app-1785828429999.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    initPerformance();
    instrumentWebViewRequests();
    void initCrashlytics();
    initInAppMessaging();
    installGlobalErrorHandlers();
    void migrateAppState();
    initNativeOAuthListeners();
    startNetworkWatcher();
    startSyncEngine();
    markAppReady();
    // Dismiss the native launch splash now that the UI has mounted.
    hideNativeSplash();
    setPushNavigator((path: string) => void router.navigate({ to: path as never }));
    setRecoveryNavigator((path: string) => void router.navigate({ to: path as never, replace: true }));
    // Supabase raises PASSWORD_RECOVERY once the reset link's session is parsed.
    const { data: recoverySub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") goToResetPassword();
    });
    const disposeTheme = initTheme();
    const disposeBack = initAndroidBackButton(() => {
      void router.navigate({ to: "/home", replace: true });
    });
    return () => {
      setPushNavigator(null);
      setRecoveryNavigator(null);
      recoverySub.subscription.unsubscribe();
      disposeTheme?.();
      disposeBack();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Breadcrumb the current screen/feature so crash reports say where the user was.
  useEffect(() => {
    const apply = (pathname: string) => setScreen(pathname, featureForPath(pathname));
    apply(window.location.pathname);
    return router.subscribe("onResolved", ({ toLocation }) => apply(toLocation.pathname));
  }, [router]);

  // Back online: retry queued writes and silently refresh cached data. The
  // banner hides itself; we never navigate or sign anyone out here.
  useEffect(() => {
    return subscribeNetwork((online) => {
      analytics.track(online ? "network_online" : "offline_mode");
      if (!online) return;
      analytics.track("sync_started");
      void flushQueue();
      void queryClient.invalidateQueries();
    });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n} defaultNS="translation">
        <AuthProvider>
        <SubscriptionProvider>
          <PermissionsProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <Toaster
              position="top-center"
              // Keep toasts (badge unlocks, etc.) clear of the Android status
              // bar / notch by honouring the device safe-area inset.
              offset="calc(env(safe-area-inset-top, 0px) + 16px)"
              mobileOffset="calc(env(safe-area-inset-top, 0px) + 16px)"
            />
          </PermissionsProvider>
        </SubscriptionProvider>
        </AuthProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
