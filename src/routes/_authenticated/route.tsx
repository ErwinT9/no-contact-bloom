import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { GuidedExerciseBar } from "@/components/GuidedExerciseBar";
import { waitForOAuthSession } from "@/lib/auth/oauthHash";
import { getCachedSession } from "@/lib/auth/session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // If we landed here straight from an OAuth redirect, let supabase-js finish
    // parsing the URL fragment (and clean it up) before checking the session.
    await waitForOAuthSession();
    // Auth state comes from the cached session, never from network reachability:
    // getUser() would fail in airplane mode and bounce signed-in users to /auth.
    const session = await getCachedSession();
    if (!session?.user) throw redirect({ to: "/auth" });
    return { user: session.user };
  },
  component: () => (
    <>
      <GuidedExerciseBar />
      <Outlet />
    </>
  ),
});