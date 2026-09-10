import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/oauth/google-drive/return")({
  head: () => ({
    meta: [
      { title: "Finishing Google Drive connection | STEADY" },
      { name: "description", content: "Completing the Google Drive connection for STEADY." },
      { property: "og:title", content: "Finishing Google Drive connection | STEADY" },
      { property: "og:description", content: "Completing the Google Drive connection." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DriveOAuthReturn,
});

const CONNECTOR_ID = "google_drive";
const NATIVE_SCHEME = "com.nocontacttracker.app://drive-callback";

function DriveOAuthReturn() {
  const [message, setMessage] = useState("Finishing your Google Drive connection…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success") === "true";
    const code = params.get("code");
    const offlineDenied = params.get("offline_access_allowed") === "false";
    const error = params.get("error");

    // Native: hand the one-time code back to the app through the deep link.
    if (params.get("native") === "1") {
      const next = new URLSearchParams();
      next.set("success", success ? "true" : "false");
      if (code) next.set("code", code);
      if (error) next.set("error", error);
      setMessage("Returning to STEADY…");
      window.location.replace(`${NATIVE_SCHEME}?${next.toString()}`);
      return;
    }

    const notify = (type: string, payload?: string | null) => {
      window.opener?.postMessage(
        { type, connectorId: CONNECTOR_ID, code: payload ?? null },
        window.location.origin,
      );
      window.close();
    };

    if (!success) {
      setMessage(error ?? "The Google Drive connection did not complete.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    if (!code) {
      if (offlineDenied) {
        notify("appUserConnectorOAuthComplete");
        return;
      }
      setMessage("Google finished without a connection code.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    notify("appUserConnectorOAuthComplete", code);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <p className="text-center text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
