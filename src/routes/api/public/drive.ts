/**
 * STEADY ↔ each user's own Google Drive.
 *
 * This endpoint is the ONLY place that touches Drive credentials. Each
 * signed-in user authorizes their own Google account (scope drive.file); the
 * resulting per-user connection key is stored encrypted in
 * `public.app_user_connections`. Picture bytes pass through here into the
 * user's Drive — they are never written to Supabase Storage.
 *
 * It lives under /api/public/* so the native Android build (a static bundle
 * with no server runtime of its own) can call it over https. The caller is
 * authenticated inside the handler with their Supabase bearer token.
 */
import { createFileRoute } from "@tanstack/react-router";

const CONNECTOR_ID = "google_drive";
const GATEWAY = "https://connector-gateway.lovable.dev";
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
];
const ROOT_FOLDER = "STEADY";
const PICTURES_FOLDER = "Pictures";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/* ---------------------------------------------------------------- crypto --- */

async function aesKey(): Promise<CryptoKey> {
  const raw = process.env["APP_USER_CONNECTION_KEY_SECRET"];
  if (!raw) throw new Error("APP_USER_CONNECTION_KEY_SECRET is not set");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

async function encryptKey(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(),
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return toBase64(packed);
}

async function decryptKey(stored: string): Promise<string> {
  const packed = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.subarray(0, 12) },
    await aesKey(),
    packed.subarray(12),
  );
  return new TextDecoder().decode(plain);
}

/* --------------------------------------------------------------- gateway --- */

function lovableKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY is not set");
  return key;
}

function clientKey(): string {
  const key = process.env["GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY"];
  if (!key) throw new Error("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
  return key;
}

async function driveFetch(
  connectionKey: string,
  path: string,
  init: RequestInit = {},
  absolute = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${lovableKey()}`);
  headers.set("X-Connection-Api-Key", connectionKey);
  headers.set("X-Lovable-Required-Scopes", SCOPES.join(" "));
  const url = absolute ? path : `${GATEWAY}/${CONNECTOR_ID}${path}`;
  return fetch(url, { ...init, headers });
}

async function needsReconnect(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.clone().json().catch(() => null)) as { type?: unknown } | null;
  return typeof body?.type === "string" && body.type.startsWith("credential_");
}

/* ----------------------------------------------------------------- drive --- */

async function findFolder(
  connectionKey: string,
  name: string,
  parentId: string | null,
): Promise<string | null> {
  const clauses = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean) as string[];
  const query = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: "10",
  });
  const res = await driveFetch(connectionKey, `/drive/v3/files?${query.toString()}`);
  if (!res.ok) {
    console.error(`[drive] folder lookup "${name}" failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  const body = (await res.json()) as { files?: Array<{ id?: string }> };
  return body.files?.[0]?.id ?? null;
}

async function createFolder(
  connectionKey: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const res = await driveFetch(connectionKey, "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed [${res.status}]: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** STEADY/Pictures — created once, reused afterwards. */
async function ensurePicturesFolder(connectionKey: string): Promise<string> {
  const root =
    (await findFolder(connectionKey, ROOT_FOLDER, null)) ??
    (await createFolder(connectionKey, ROOT_FOLDER, null));
  return (
    (await findFolder(connectionKey, PICTURES_FOLDER, root)) ??
    (await createFolder(connectionKey, PICTURES_FOLDER, root))
  );
}

/* -------------------------------------------------------------- supabase --- */

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Verifies the caller's Supabase access token and returns their user id. */
async function authenticate(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  if (token.split(".").length !== 3) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase environment variables are missing");
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { id?: string };
  return body.id ?? null;
}

async function loadConnectionKey(userId: string): Promise<string | null> {
  const admin = await adminClient();
  const { data, error } = await admin
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", CONNECTOR_ID)
    .maybeSingle();
  if (error) throw error;
  return data ? await decryptKey(data.connection_key_ciphertext) : null;
}

/* ---------------------------------------------------------------- handler --- */

export const Route = createFileRoute("/api/public/drive")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const userId = await authenticate(request);
          if (!userId) return json({ error: "Unauthorized" }, 401);

          const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = String(payload["action"] ?? "");

          /* ---- connection state --------------------------------------- */

          if (action === "status") {
            const key = await loadConnectionKey(userId);
            if (!key) return json({ connected: false });
            const res = await driveFetch(key, "/drive/v3/about?fields=user(emailAddress)");
            if (await needsReconnect(res)) {
              return json({ connected: false, reconnectRequired: true });
            }
            if (!res.ok) return json({ connected: true, account: null });
            const body = (await res.json().catch(() => ({}))) as {
              user?: { emailAddress?: string };
            };
            return json({ connected: true, account: body.user?.emailAddress ?? null });
          }

          if (action === "start") {
            const returnUrl = String(payload["returnUrl"] ?? "");
            if (!returnUrl.startsWith("https://")) return json({ error: "Invalid return URL" }, 400);
            const existing = await loadConnectionKey(userId);
            const headers: Record<string, string> = {
              Authorization: `Bearer ${lovableKey()}`,
              "Content-Type": "application/json",
              "X-Client-Api-Key": clientKey(),
            };
            if (existing) headers["X-Connection-Api-Key"] = existing;
            const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/authorize`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                connector_id: CONNECTOR_ID,
                app_user_id: userId,
                return_url: returnUrl,
                credentials_configuration: { scopes: SCOPES },
              }),
            });
            const text = await res.text();
            if (!res.ok) {
              console.error(`[drive] authorize failed [${res.status}]: ${text}`);
              return json({ error: "Google Drive could not be connected right now." }, 502);
            }
            const body = JSON.parse(text) as { authorization_url?: string };
            if (!body.authorization_url) return json({ error: "No authorization URL" }, 502);
            return json({ authorizationUrl: body.authorization_url });
          }

          if (action === "complete") {
            const code = String(payload["code"] ?? "");
            if (!code) return json({ error: "Missing code" }, 400);
            const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/exchange`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${lovableKey()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ code }),
            });
            const text = await res.text();
            if (!res.ok) {
              console.error(`[drive] exchange failed [${res.status}]: ${text}`);
              return json({ error: "Could not finish connecting Google Drive." }, 502);
            }
            const body = JSON.parse(text) as { api_key?: string; connector_id?: string };
            if (body.connector_id !== CONNECTOR_ID) return json({ error: "Wrong connector" }, 400);
            if (!body.api_key) return json({ error: "No connection key returned" }, 502);
            const admin = await adminClient();
            const { error } = await admin.from("app_user_connections").upsert(
              {
                user_id: userId,
                connector_id: CONNECTOR_ID,
                connection_key_ciphertext: await encryptKey(body.api_key),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,connector_id" },
            );
            if (error) throw error;
            return json({ ok: true });
          }

          if (action === "disconnect") {
            const key = await loadConnectionKey(userId);
            if (key) {
              const res = await fetch(`${GATEWAY}/api/v1/app-users/connection`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${lovableKey()}`,
                  "X-Connection-Api-Key": key,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ connector_id: CONNECTOR_ID }),
              });
              if (!res.ok) {
                console.error(`[drive] disconnect [${res.status}]: ${await res.text()}`);
              }
            }
            const admin = await adminClient();
            const { error } = await admin
              .from("app_user_connections")
              .delete()
              .eq("user_id", userId)
              .eq("connector_id", CONNECTOR_ID);
            if (error) throw error;
            return json({ ok: true });
          }

          /* ---- picture operations ------------------------------------- */

          const connectionKey = await loadConnectionKey(userId);
          if (!connectionKey) {
            return json({ connected: false, error: "Google Drive not connected" }, 409);
          }

          if (action === "upload") {
            const dataUrl = String(payload["dataUrl"] ?? "");
            const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
            if (!match) return json({ error: "Invalid image data" }, 400);
            const mimeType = match[1];
            const name = String(payload["name"] ?? `picture-${Date.now()}.jpg`);
            const folderId = await ensurePicturesFolder(connectionKey);

            const boundary = `steady${crypto.randomUUID()}`;
            const metadata = JSON.stringify({ name, parents: [folderId] });
            const head =
              `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}` +
              `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
            const body = `${head}${match[2]}\r\n--${boundary}--`;

            const res = await driveFetch(
              connectionKey,
              `${GATEWAY}/${CONNECTOR_ID}/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`,
              {
                method: "POST",
                headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
                body,
              },
              true,
            );
            if (await needsReconnect(res)) return json({ reconnectRequired: true }, 409);
            if (!res.ok) {
              console.error(`[drive] upload failed [${res.status}]: ${await res.text()}`);
              return json({ error: `Drive upload failed [${res.status}]` }, 502);
            }
            const created = (await res.json()) as { id: string; webViewLink?: string };
            return json({ fileId: created.id, webViewLink: created.webViewLink ?? null });
          }

          if (action === "get") {
            const fileId = String(payload["fileId"] ?? "");
            if (!fileId) return json({ error: "Missing fileId" }, 400);
            const res = await driveFetch(
              connectionKey,
              `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            );
            if (await needsReconnect(res)) return json({ reconnectRequired: true }, 409);
            if (!res.ok) {
              console.error(`[drive] read failed [${res.status}]: ${await res.text()}`);
              return json({ error: `Drive read failed [${res.status}]` }, 502);
            }
            const mimeType = res.headers.get("content-type") ?? "image/jpeg";
            const bytes = new Uint8Array(await res.arrayBuffer());
            return json({ dataUrl: `data:${mimeType};base64,${toBase64(bytes)}` });
          }

          if (action === "delete") {
            const fileId = String(payload["fileId"] ?? "");
            if (!fileId) return json({ error: "Missing fileId" }, 400);
            const res = await driveFetch(
              connectionKey,
              `/drive/v3/files/${encodeURIComponent(fileId)}`,
              { method: "DELETE" },
            );
            if (!res.ok && res.status !== 404) {
              console.error(`[drive] delete failed [${res.status}]: ${await res.text()}`);
              return json({ error: `Drive delete failed [${res.status}]` }, 502);
            }
            return json({ ok: true });
          }

          return json({ error: "Unknown action" }, 400);
        } catch (error) {
          console.error("[drive] request failed:", error);
          return json({ error: "Google Drive request could not be completed." }, 500);
        }
      },
    },
  },
});
