import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

import { supabase } from "@/integrations/supabase/client";
import { handleDriveDeepLink } from "@/lib/drive/client";
import { isNative } from "@/lib/native/platform";
import { goToResetPassword, isRecoveryUrl, setRecoveryActive } from "@/lib/auth/passwordRecovery";

/** Custom scheme registered in AndroidManifest.xml for the OAuth callback. */
export const NATIVE_REDIRECT_URL = "com.nocontacttracker.app://auth-callback";

let listenersRegistered = false;
let pendingSignIn = false;
let onErrorHandler: ((message: string) => void) | null = null;
let onPendingChange: ((pending: boolean) => void) | null = null;

function setPending(next: boolean) {
  pendingSignIn = next;
  onPendingChange?.(next);
}

/** Lets the auth screen show errors / reset its spinner from the deep-link handler. */
export function setNativeOAuthHandlers(handlers: {
  onError?: (message: string) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  onErrorHandler = handlers.onError ?? null;
  onPendingChange = handlers.onPendingChange ?? null;
}

async function closeBrowser() {
  try {
    await Browser.close();
  } catch {
    // Custom Tab already dismissed — nothing to close.
  }
}

/** Turns a deep-link callback URL into a Supabase session. */
export async function completeNativeOAuth(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const recovery = isRecoveryUrl(url);
  if (recovery) setRecoveryActive(true);

  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const errorDescription =
    query.get("error_description") ?? fragment.get("error_description") ?? query.get("error");

  if (errorDescription) {
    await closeBrowser();
    setPending(false);
    onErrorHandler?.(errorDescription);
    return true;
  }

  const code = query.get("code");
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");

  if (!code && !accessToken) return false;

  await closeBrowser();

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }
    setPending(false);
    // A recovery link must land on the dedicated Reset Password screen,
    // never in onboarding or the main app.
    if (recovery) goToResetPassword();
    return true;
  } catch (error) {
    setPending(false);
    onErrorHandler?.(error instanceof Error ? error.message : "Sign-in could not be completed.");
    return true;
  }
}

/**
 * Registers the deep-link + resume listeners once, at app start.
 * No-op on the web build.
 */
export function initNativeOAuthListeners() {
  if (!isNative() || listenersRegistered) return;
  listenersRegistered = true;

  void App.addListener("appUrlOpen", (event) => {
    if (!event.url?.startsWith("com.nocontacttracker.app://")) return;
    // Google Drive authorization returns on its own host and is handled there.
    if (handleDriveDeepLink(event.url)) return;
    void completeNativeOAuth(event.url);
  });

  // If the user swipes the Custom Tab away, don't leave the button spinning.
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive || !pendingSignIn) return;
    window.setTimeout(() => {
      if (!pendingSignIn) return;
      void supabase.auth.getSession().then(({ data }) => {
        if (!data.session) setPending(false);
      });
    }, 700);
  });
}

/**
 * Web: normal Supabase browser redirect back to /auth.
 * Android: Custom Tab + deep-link callback, finished inside the app.
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (!isNative()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    return { error: error?.message ?? null };
  }

  setPending(true);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    setPending(false);
    return { error: error?.message ?? "Could not start Google sign-in." };
  }

  try {
    await Browser.open({ url: data.url, presentationStyle: "popover" });
  } catch (caught) {
    setPending(false);
    return {
      error: caught instanceof Error ? caught.message : "Could not open the Google sign-in page.",
    };
  }

  return { error: null };
}