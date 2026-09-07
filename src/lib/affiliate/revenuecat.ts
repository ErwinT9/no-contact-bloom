import { InsertAffiliate } from "insert-affiliate-js-sdk";

import { isNative } from "@/lib/native/platform";

/**
 * Bridges Insert Affiliate attribution into RevenueCat customer attributes,
 * following the official Insert Affiliate RevenueCat integration:
 * the affiliate identifier is stored on the `insert_affiliate` attribute
 * (plus `insert_timedout` and `affiliateOfferCode`) BEFORE any purchase.
 *
 * Safe to call repeatedly and safe when the user arrived without an affiliate
 * link — in that case nothing is written to RevenueCat.
 */

/** TEMPORARY diagnostic logging so attribution can be verified in logcat. */
function log(event: string, detail?: Record<string, unknown>) {
  if (detail) console.log(`[insert-affiliate:rc] ${event}`, detail);
  else console.log(`[insert-affiliate:rc] ${event}`);
}

/** The RevenueCat plugin touches browser globals on import, so load it lazily. */
async function rc() {
  return import("@revenuecat/purchases-capacitor");
}

let lastSyncedIdentifier: string | null = null;

/**
 * Reads the current Insert Affiliate identifier and, when one exists, sets it
 * as the RevenueCat `insert_affiliate` customer attribute.
 * Returns the identifier that was synced, or null when there is nothing to do.
 */
export async function syncAffiliateToRevenueCat(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!isNative()) {
    log("skipped:not_native");
    return null;
  }

  try {
    const identifier = await InsertAffiliate.returnInsertAffiliateIdentifier();
    if (!identifier) {
      log("no_affiliate_detected");
      return null;
    }
    log("affiliate_detected", { identifier });

    if (identifier === lastSyncedIdentifier) {
      log("already_synced", { identifier });
      return identifier;
    }

    const { Purchases } = await rc();
    // Ensure the RevenueCat subscriber exists before writing attributes.
    await Purchases.getCustomerInfo();

    const expiryTimestamp = await InsertAffiliate.getAffiliateExpiryTimestamp();
    const offerCode = await InsertAffiliate.getOfferCode();

    const attributes: Record<string, string> = {
      insert_affiliate: identifier,
      insert_timedout: expiryTimestamp?.toString() ?? "",
    };
    if (offerCode) attributes["affiliateOfferCode"] = offerCode;

    await Purchases.setAttributes(attributes);
    await Purchases.syncAttributesAndOfferingsIfNeeded();

    lastSyncedIdentifier = identifier;
    log("attribute_set_success", {
      insert_affiliate: identifier,
      insert_timedout: attributes["insert_timedout"],
      affiliateOfferCode: offerCode ?? null,
    });
    return identifier;
  } catch (error) {
    log("attribute_set_failed", { error: (error as Error)?.message ?? String(error) });
    return null;
  }
}

/**
 * Registers the SDK callback so a newly detected affiliate is pushed to
 * RevenueCat as soon as attribution changes.
 */
export function watchAffiliateForRevenueCat(): void {
  if (typeof window === "undefined") return;
  InsertAffiliate.setInsertAffiliateIdentifierChangeCallback((identifier) => {
    log("identifier_changed", { identifier: identifier ?? null });
    if (!identifier) return;
    void syncAffiliateToRevenueCat();
  });
}
