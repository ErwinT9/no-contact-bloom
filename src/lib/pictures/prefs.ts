/**
 * Remembers where NEW pictures should be saved: this device or Google Drive.
 * Cached locally so the choice is instant and works offline.
 */
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/native/storage";

export type StorageLocation = "local" | "google_drive";

const key = (userId: string) => `nc:picture-storage:${userId}`;

export async function getStorageLocation(userId: string): Promise<StorageLocation> {
  const cached = await storage.get<StorageLocation | null>(key(userId), null);
  if (cached === "local" || cached === "google_drive") return cached;
  try {
    const { data } = await supabase
      .from("user_picture_prefs")
      .select("storage_location")
      .eq("user_id", userId)
      .maybeSingle();
    const value = data?.storage_location;
    if (value === "local" || value === "google_drive") {
      await storage.set(key(userId), value);
      return value;
    }
  } catch {
    // Offline: fall back to the safe default.
  }
  return "local";
}

export async function setStorageLocation(
  userId: string,
  location: StorageLocation,
): Promise<StorageLocation> {
  await storage.set(key(userId), location);
  try {
    await supabase
      .from("user_picture_prefs")
      .upsert({ user_id: userId, storage_location: location }, { onConflict: "user_id" });
  } catch {
    // The local choice still applies; the cloud copy can catch up later.
  }
  return location;
}
