import { InsertAffiliate } from "insert-affiliate-js-sdk";

const INSERT_AFFILIATE_COMPANY_CODE = "NPtL2fWIcMew0AzjOs2BhSs7mew1";

let initStarted = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the Insert Affiliate SDK once, as early as possible during app
 * startup. Verbose logging is enabled for development/testing; disable it
 * before shipping to production. Insert Links deep-linking is used, which is
 * automatic once the SDK is initialized.
 *
 * This is a no-op on the server. It should be called before any RevenueCat
 * attribution logic so affiliate data is already present when needed.
 */
export async function initializeInsertAffiliate(): Promise<void> {
  if (typeof window === "undefined") return;
  if (initStarted) return initPromise ?? Promise.resolve();
  initStarted = true;

  initPromise = InsertAffiliate.initialize(INSERT_AFFILIATE_COMPANY_CODE, true)
    .then(() => {
      console.log("[insert-affiliate] SDK initialized");
    })
    .catch((error) => {
      console.error("[insert-affiliate] SDK initialization failed", error);
      // Do not block app startup if the SDK fails to load.
    });

  return initPromise;
}

/** Promise that resolves when affiliate SDK initialization has completed. */
export function insertAffiliateReady(): Promise<void> {
  return initPromise ?? Promise.resolve();
}
