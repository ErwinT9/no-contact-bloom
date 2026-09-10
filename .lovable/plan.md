# Pictures in your own Google Drive — audit and plan

## Audit answers

**1. How pictures are stored today**
The photo file itself goes into a private Supabase Storage bucket named `activity-pictures`, under a folder per user (`<user-id>/<random>.jpg`). The upload happens straight from the app in `src/routes/_authenticated/pictures.tsx`.

**2. What metadata is stored in Supabase**
A row per picture in the `pictures` table: `id`, `user_id`, `image_url` (the storage path, not a link), `caption`, `taken_on`, `created_at`, `updated_at`.

**3. Are captions in Supabase?** Yes — the `caption` column, plus a copy in the device's offline cache.

**4. How the gallery loads**
It lists the `pictures` rows (offline-cached), then asks Supabase Storage for temporary signed links (1 hour) for all paths at once and renders a 2-column grid.

**5. Can this be moved to Drive cleanly?**
Yes. The file and the record are already separate: `image_url` is just a pointer. Swapping the pointer from "storage path" to "Drive file id" leaves listing, captions, dates, delete and offline caching intact.

**6. Existing Supabase pictures**
Nothing is deleted or moved. Old pictures keep working exactly as today; each record simply remembers where it lives ("STEADY servers" or "your Google Drive"). Later, if you want, we can add an opt-in "Move my older pictures to Drive" button — not part of this work.

**7. Google configuration required**
A Google OAuth client set up once through Lovable's Google Drive per-user connector, with the Lovable callback added as an authorized redirect URI. Each person then authorizes their own Google account inside STEADY. Google sign-in for logging into STEADY does **not** grant Drive access, so email/password users and Google users go through the same separate "Connect Google Drive" step.

**8. Is `drive.file` enough?** Yes. STEADY only ever touches folders and files it created itself, which is exactly what `drive.file` covers: creating the `STEADY/Pictures` folders, uploading, reading back, renaming, deleting. No broad Drive access is requested.

**9. Capacitor Android limitations (important)**
- The authorization screen cannot open in the app's own web view; it must open in the system browser and return to the app through the existing `com.nocontacttracker.app://` deep link. The web build keeps the popup flow. This is the main piece of new plumbing.
- Drive thumbnails are not publicly viewable, so image bytes are fetched through STEADY's server on behalf of the signed-in user and cached on the device. Previously uploaded photos already on the phone stay visible offline; brand-new Drive photos need a connection the first time they are shown.
- Uploads pass through STEADY's server as a stream; large photos are downscaled on the device first (same approach already used for profile photos) to stay within request limits.
- Adding a picture requires a connection — offline "add" is queued as today but the Drive upload only completes once online.

**10. What stays in Supabase**
Only text metadata, never the image: `id`, `user_id`, a Drive file id, the storage kind (`drive` / `supabase`), `caption`, `taken_on`, timestamps, and optionally a Drive web link. No image binary is written to Supabase Storage for new pictures.

## Proposed architecture

```text
STEADY app
  → "Connect Google Drive" (per-user Google authorization, scope drive.file)
  → STEADY server (holds the per-user connection securely)
  → user's Google Drive
        STEADY/
          Pictures/
            2026-09-10-<id>.jpg
```

Per-user Drive connections are stored encrypted on the server, keyed to the signed-in STEADY account. The browser never holds Google credentials.

## What gets built

1. **Drive connection layer** — link the Google Drive per-user connector, add the server-only helpers, an encrypted `app_user_connections` table, connect / disconnect / status server functions, and Android deep-link return handling alongside the web popup.
2. **Drive picture service (server side)** — find-or-create `STEADY` → `Pictures` folders once per user, upload a photo, stream bytes back for display, rename (caption change is metadata only), delete, and produce the "Open in Google Drive" link.
3. **Database** — add `storage_kind` and `drive_file_id` (and Drive web link) to `pictures`; existing rows default to the current behaviour.
4. **Gallery redesign** — clean responsive 2-column grid with thumbnail, date added, caption; subtle "Stored privately in your Google Drive" indicator.
5. **Full-screen viewer** — large image, caption, date added, Edit Caption, Delete, Open in Google Drive.
6. **Add-picture flow** — when Drive is not connected: "Keep your memories private" explanation, the two supporting lines, and a "Connect Google Drive" button; once connected, camera/gallery picking works as it does now.
7. **Privacy copy** — "Your pictures are stored privately in your Google Drive, not on STEADY's servers." No claim of zero access, since STEADY needs authorized Drive access to upload and show them.

Untouched: authentication, navigation, other screens, badges, streaks, and every other feature.

## Notes before we start

- Connecting the Google Drive connector needs one approval step from you, and the Google OAuth client must list Lovable's callback URL.
- If a person disconnects Drive or revokes access, their Drive-backed pictures stop loading until they reconnect; the records and captions remain.
- The Android authorization round-trip can only be fully verified in a real device build.
