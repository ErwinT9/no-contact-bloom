/**
 * Stores picture bytes on the user's own device.
 * Native (Android/iOS): app-private Filesystem data directory.
 * Web: IndexedDB, so images survive reloads without ever touching a server.
 */
import { Directory, Filesystem } from "@capacitor/filesystem";

import { isNative } from "@/lib/native/platform";

const DB_NAME = "steady-pictures";
const STORE = "images";
const FOLDER = "steady-pictures";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local album unavailable"));
  });
}

async function webPut(key: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save on this device"));
  });
  db.close();
}

async function webGet(key: string): Promise<string | null> {
  const db = await openDb();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read that picture"));
  });
  db.close();
  return value;
}

async function webDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

function stripPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Saves the image on the device and returns the local reference to remember. */
export async function saveLocalPicture(id: string, dataUrl: string): Promise<string> {
  if (isNative()) {
    const path = `${FOLDER}/${id}.jpg`;
    await Filesystem.mkdir({ path: FOLDER, directory: Directory.Data, recursive: true }).catch(
      () => undefined,
    );
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: stripPrefix(dataUrl),
    });
    return path;
  }
  await webPut(id, dataUrl);
  return id;
}

export async function readLocalPicture(reference: string): Promise<string | null> {
  try {
    if (isNative()) {
      const { data } = await Filesystem.readFile({ path: reference, directory: Directory.Data });
      const base64 = typeof data === "string" ? data : "";
      return base64 ? `data:image/jpeg;base64,${base64}` : null;
    }
    return await webGet(reference);
  } catch {
    return null;
  }
}

export async function removeLocalPicture(reference: string): Promise<void> {
  try {
    if (isNative()) {
      await Filesystem.deleteFile({ path: reference, directory: Directory.Data });
      return;
    }
    await webDelete(reference);
  } catch {
    // A missing file must never block deleting the album entry.
  }
}
