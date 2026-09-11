/**
 * Client side of the Google Drive picture storage.
 *
 * All Drive traffic goes through the app's own /api/public/drive endpoint,
 * authenticated with the signed-in user's Supabase token. The browser never
 * holds Google credentials.
 *
 * The native Android build ships as a static bundle with no server of its
 * own, so it calls the published site over https.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNative } from "@/lib/native/platform";

/** Published origin — the native app's server for Drive requests + OAuth return. */
export const PUBLIC_ORIGIN = "https://no-contact-bloom.lovable.app";
export const DRIVE_CALLBACK_SCHEME = "com.nocontacttracker.app://drive-callback";
export const DRIVE_CONNECTOR_ID = "google_drive";

function endpoint(): string {
  if (isNative()) return `${PUBLIC_ORIGIN}/api/public/drive`;
  return "/api/public/drive";
}

/** Origin used for the OAuth return page (must be publicly reachable). */
export function driveReturnUrl(): string {
  const origin = isNative() ? PUBLIC_ORIGIN : window.location.origin;
  const url = new URL("/oauth/google-drive/return", origin);
  if (isNative()) url.searchParams.set("native", "1");
  return url.toString();
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You need to be signed in.");
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 409) {
    const message = String(body["error"] ?? "Google Drive request failed.");
    const reason = typeof body["reason"] === "string" ? body["reason"] : null;
    if (reason && import.meta.env.DEV) console.error("[drive]", action, message, reason);
    throw new Error(reason ? `${message} — ${reason}` : message);
  }
  return body as T;
}

export type DriveStatus = {
  connected: boolean;
  reconnectRequired?: boolean;
  account?: string | null;
};

export const drive = {
  status: () => call<DriveStatus>("status"),
  start: (returnUrl: string) => call<{ authorizationUrl: string }>("start", { returnUrl }),
  complete: (code: string) => call<{ ok?: boolean }>("complete", { code }),
  disconnect: () => call<{ ok?: boolean }>("disconnect"),
  upload: (dataUrl: string, name: string) =>
    call<{ fileId?: string; webViewLink?: string | null; reconnectRequired?: boolean }>("upload", {
      dataUrl,
      name,
    }),
  get: (fileId: string) =>
    call<{ dataUrl?: string; reconnectRequired?: boolean }>("get", { fileId }),
  remove: (fileId: string) => call<{ ok?: boolean }>("delete", { fileId }),
};

/* --------------------------------------------------- native deep-link glue --- */

type CodeHandler = (code: string | null, error?: string) => void;

let pendingNative: CodeHandler | null = null;

/** Called by the app-wide deep-link listener for com.nocontacttracker.app://drive-callback. */
export function handleDriveDeepLink(rawUrl: string): boolean {
  if (!rawUrl.startsWith(DRIVE_CALLBACK_SCHEME)) return false;
  let params: URLSearchParams;
  try {
    params = new URL(rawUrl).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const handler = pendingNative;
  pendingNative = null;
  if (params.get("success") === "true") {
    handler?.(params.get("code"));
  } else {
    handler?.(null, params.get("error") ?? "Google Drive connection was cancelled.");
  }
  return true;
}

function waitForNativeCode(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    pendingNative = (code, error) => (error ? reject(new Error(error)) : resolve(code));
    window.setTimeout(() => {
      if (!pendingNative) return;
      pendingNative = null;
      reject(new Error("Google Drive connection timed out."));
    }, 300_000);
  });
}

/* -------------------------------------------------------------- web popup --- */

function waitForPopupCode(popup: Window): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        (event.data as { connectorId?: string } | null)?.connectorId !== DRIVE_CONNECTOR_ID ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) {
        return;
      }
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        const code = (event.data as { code?: string | null }).code;
        resolve(typeof code === "string" ? code : null);
        return;
      }
      popup.close();
      reject(new Error("Google Drive connection failed."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The Google window was closed before finishing."));
    }, 500);
  });
}

/**
 * Runs the full per-user Google Drive authorization and stores the resulting
 * connection server-side. Resolves once the connection is saved.
 */
export async function connectGoogleDrive(): Promise<void> {
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    const completion = waitForNativeCode();
    const { authorizationUrl } = await drive.start(driveReturnUrl());
    await Browser.open({ url: authorizationUrl, presentationStyle: "popover" });
    const code = await completion;
    try {
      await Browser.close();
    } catch {
      // Already dismissed.
    }
    if (code) await drive.complete(code);
    return;
  }

  const popup = window.open("", "steady-drive-oauth", "width=600,height=720");
  if (!popup) throw new Error("Please allow pop-ups and try again.");
  let code: string | null;
  try {
    const { authorizationUrl } = await drive.start(driveReturnUrl());
    const completion = waitForPopupCode(popup);
    popup.location.href = authorizationUrl;
    code = await completion;
  } catch (error) {
    popup.close();
    throw error;
  }
  if (code) await drive.complete(code);
}
