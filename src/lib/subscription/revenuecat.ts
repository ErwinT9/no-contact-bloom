import { analytics } from "@/lib/analytics";

import { isNative, platformName, safeNative } from "@/lib/native/platform";
import { STORAGE_KEYS, storage } from "@/lib/native/storage";
import { rcLog, rcLogError } from "@/lib/subscription/rcDebug";

export const REVENUECAT_ANDROID_KEY = import.meta.env["VITE_REVENUECAT_ANDROID_KEY"] ?? "";
export const ENTITLEMENT_ID = "pro";

export type EntitlementState = {
  isPremium: boolean;
  willRenew: boolean;
  expiresAt: string | null;
  checkedAt: string;
};

const DEFAULT_STATE: EntitlementState = {
  isPremium: false,
  willRenew: false,
  expiresAt: null,
  checkedAt: new Date(0).toISOString(),
};

let configured = false;
/** TEMPORARY: last configure() failure, surfaced in diagnostics instead of being swallowed. */
let configureError: string | null = null;

export function lastConfigureError(): string | null {
  return configureError;
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

/**
 * The RevenueCat plugin registers itself against browser globals on import,
 * so it is only loaded lazily inside native code paths (never during SSR).
 */
async function rc() {
  return import("@revenuecat/purchases-capacitor");
}

/** Reads the locally cached entitlement so premium keeps working offline. */
export async function getCachedEntitlement(): Promise<EntitlementState> {
  return storage.get<EntitlementState>(STORAGE_KEYS.entitlement, DEFAULT_STATE);
}

async function cacheEntitlement(state: EntitlementState): Promise<EntitlementState> {
  await storage.set(STORAGE_KEYS.entitlement, state);
  return state;
}

export async function configureRevenueCat(appUserId?: string): Promise<void> {
  if (!isNative()) {
    rcLog("configure:skipped_not_native", { platform: platformName() });
    return;
  }
  if (configured) {
    rcLog("configure:already_configured");
    return;
  }
  const key = REVENUECAT_ANDROID_KEY;
  rcLog("configure:start", {
    platform: platformName(),
    keyPresent: Boolean(key),
    keyPrefix: key ? key.slice(0, 5) : null,
    keyLength: key.length,
    appUserId: appUserId ? `${appUserId.slice(0, 8)}…` : null,
  });
  if (!key) {
    configureError = "VITE_REVENUECAT_ANDROID_KEY is empty in this build";
    rcLog("configure:missing_key");
    return;
  }
  try {
    const { Purchases, LOG_LEVEL } = await rc();
    // TEMPORARY: verbose native logs so `adb logcat` shows RevenueCat's own trace.
    await Purchases.setLogLevel({ level: LOG_LEVEL.VERBOSE });
    await Purchases.configure(
      appUserId
        ? { apiKey: key, appUserID: appUserId }
        : { apiKey: key },
    );
    configured = true;
    configureError = null;
    rcLog("configure:success");
  } catch (error) {
    configureError = (error as Error)?.message ?? String(error);
    rcLogError("configure:failed", error);
  }
}

export async function identifyUser(appUserId: string): Promise<void> {
  if (!isNative()) return;
  await safeNative(async () => {
    await configureRevenueCat(appUserId);
    const { Purchases } = await rc();
    await Purchases.logIn({ appUserID: appUserId });
  });
}

export async function logOutRevenueCat(): Promise<void> {
  await safeNative(async () => {
    const { Purchases } = await rc();
    await Purchases.logOut();
  });
  await cacheEntitlement(DEFAULT_STATE);
}

function toState(info: { entitlements: { active: Record<string, unknown> } }): EntitlementState {
  const active = info.entitlements.active[ENTITLEMENT_ID] as
    | { willRenew?: boolean; expirationDate?: string | null }
    | undefined;
  return {
    isPremium: Boolean(active),
    willRenew: Boolean(active?.willRenew),
    expiresAt: active?.expirationDate ?? null,
    checkedAt: new Date().toISOString(),
  };
}

/** Refreshes entitlement from RevenueCat; falls back to cache on any failure. */
export async function refreshEntitlement(): Promise<EntitlementState> {
  if (!isNative()) return getCachedEntitlement();
  try {
    await configureRevenueCat();
    const { Purchases } = await rc();
    const { customerInfo } = await Purchases.getCustomerInfo();
    return cacheEntitlement(toState(customerInfo));
  } catch (error) {
    analytics.error(error, { stage: "revenuecat_refresh" });
    return getCachedEntitlement();
  }
}

export type PurchaseOutcome =
  | { status: "success"; state: EntitlementState }
  | { status: "cancelled" }
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** Normalised, UI-ready shape of a RevenueCat package from the `default` offering. */
export type OfferingPackage = {
  /** RevenueCat package identifier — used to purchase. */
  id: string;
  productId: string;
  kind: "yearly" | "weekly" | "other";
  title: string;
  priceString: string;
  /** Numeric price in the localized currency, as reported by the store. */
  price: number | null;
  currencyCode: string;
  period: string | null;
  /** e.g. "30 days free" — always derived from RevenueCat's intro/free-trial data. */
  trial: string | null;
  /** The trial phrase without the "free" suffix, e.g. "30 days". */
  trialPeriod: string | null;
};

function periodLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^P(\d+)([DWMY])$/i.exec(iso.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const unit = { D: "day", W: "week", M: "month", Y: "year" }[
    match[2]!.toUpperCase() as "D" | "W" | "M" | "Y"
  ];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function unitLabel(count: number, unit: string | null | undefined): string | null {
  if (!count || !unit) return null;
  const normalized = String(unit).toUpperCase();
  const name =
    normalized.startsWith("DAY") || normalized === "D"
      ? "day"
      : normalized.startsWith("WEEK") || normalized === "W"
        ? "week"
        : normalized.startsWith("MONTH") || normalized === "M"
          ? "month"
          : normalized.startsWith("YEAR") || normalized === "Y"
            ? "year"
            : null;
  return name ? `${count} ${name}${count === 1 ? "" : "s"}` : null;
}

/** Finds the free-trial duration RevenueCat reports, across every SDK payload shape. */
function freeTrialPeriod(product: any): string | null {
  const options: any[] = [
    product?.defaultOption,
    ...(Array.isArray(product?.subscriptionOptions) ? product.subscriptionOptions : []),
  ].filter(Boolean);

  for (const option of options) {
    const phases: any[] = [
      option?.freePhase,
      ...(Array.isArray(option?.pricingPhases) ? option.pricingPhases : []),
    ].filter(Boolean);
    for (const phase of phases) {
      const amount =
        phase?.price?.amountMicros ?? phase?.price?.amount ?? phase?.priceAmountMicros ?? null;
      const isFree = phase === option?.freePhase || amount === 0;
      if (!isFree) continue;
      const label =
        periodLabel(phase?.billingPeriod?.iso8601 ?? phase?.billingPeriod) ??
        unitLabel(Number(phase?.billingPeriod?.value ?? 0), phase?.billingPeriod?.unit);
      if (label) return label;
    }
  }

  const intro = product?.introPrice ?? null;
  if (intro && (intro.price === 0 || intro.priceString === "" || intro.price === "0")) {
    return (
      periodLabel(intro.periodISO8601 ?? intro.period ?? null) ??
      unitLabel(Number(intro.periodNumberOfUnits ?? 0), intro.periodUnit)
    );
  }
  return null;
}

function toOfferingPackage(pkg: any): OfferingPackage {
  const product = pkg.product ?? {};
  const type = String(pkg.packageType ?? "").toUpperCase();
  const id = String(pkg.identifier ?? "");
  const productId = String(product.identifier ?? "");
  const haystack = `${id} ${productId}`.toLowerCase();
  const kind: OfferingPackage["kind"] =
    type === "ANNUAL" || haystack.includes("year") || haystack.includes("annual")
      ? "yearly"
      : type === "WEEKLY" || haystack.includes("week")
        ? "weekly"
        : "other";

  const option = product.defaultOption ?? null;
  const trial = freeTrialPeriod(product);

  const period =
    periodLabel(option?.pricingPhases?.at?.(-1)?.billingPeriod?.iso8601) ??
    periodLabel(product.subscriptionPeriod ?? null) ??
    (kind === "yearly" ? "1 year" : kind === "weekly" ? "1 week" : null);

  return {
    id,
    productId,
    kind,
    title: kind === "yearly" ? "Yearly" : kind === "weekly" ? "Weekly" : (product.title ?? id),
    priceString: String(product.priceString ?? ""),
    price: (() => {
      const raw =
        product.price ??
        (product.priceAmountMicros != null ? Number(product.priceAmountMicros) / 1_000_000 : null);
      const num = Number(raw);
      return Number.isFinite(num) && num > 0 ? num : null;
    })(),
    currencyCode: String(product.currencyCode ?? ""),
    period,
    trial: trial ? `${trial} free` : null,
    trialPeriod: trial,
  };
}

export type OfferingsResult =
  | { status: "ok"; packages: OfferingPackage[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** Loads the current (`default`) offering and normalises its packages for the UI. */
export async function loadOfferings(): Promise<OfferingsResult> {
  if (!isNative()) {
    rcLog("offerings:skipped_not_native", { platform: platformName() });
    return { status: "unavailable" };
  }
  try {
    await configureRevenueCat();
    if (!configured) {
      rcLog("offerings:aborted_not_configured", { configureError });
      return {
        status: "error",
        message: `RevenueCat not configured: ${configureError ?? "unknown reason"}`,
      };
    }
    const { Purchases } = await rc();
    rcLog("offerings:getOfferings:start");
    const offerings = await Purchases.getOfferings();
    rcLog("offerings:getOfferings:success", {
      currentIdentifier: offerings.current?.identifier ?? null,
      allIdentifiers: Object.keys(offerings.all ?? {}),
      hasDefault: Boolean(offerings.all?.["default"]),
      currentPackages: (offerings.current?.availablePackages ?? []).map((p: any) => ({
        packageId: p.identifier,
        packageType: p.packageType,
        productId: p.product?.identifier,
        priceString: p.product?.priceString,
      })),
      defaultPackages: ((offerings.all?.["default"]?.availablePackages ?? []) as any[]).map((p) => ({
        packageId: p.identifier,
        packageType: p.packageType,
        productId: p.product?.identifier,
      })),
    });
    const current = offerings.current ?? offerings.all?.["default"] ?? null;
    const available = current?.availablePackages ?? [];
    if (!current) {
      rcLog("offerings:no_current_or_default_offering", {
        allIdentifiers: Object.keys(offerings.all ?? {}),
      });
      return { status: "unavailable" };
    }
    if (!available.length) {
      rcLog("offerings:empty_package_list", { offeringIdentifier: current.identifier });
      return { status: "unavailable" };
    }
    const packages = available.map(toOfferingPackage);
    rcLog("offerings:normalised", packages);
    const order = { yearly: 0, weekly: 1, other: 2 } as const;
    packages.sort((a, b) => order[a.kind] - order[b.kind]);
    return { status: "ok", packages };
  } catch (error) {
    rcLogError("offerings:getOfferings:failed", error);
    analytics.error(error, { stage: "revenuecat_offerings" });
    return { status: "error", message: (error as Error).message ?? "Could not load plans" };
  }
}

/** Purchases a specific package from the current offering by package identifier. */
export async function purchasePackageById(packageId: string): Promise<PurchaseOutcome> {
  if (!isNative()) return { status: "unavailable" };
  try {
    await configureRevenueCat();
    const { Purchases } = await rc();
    const offerings = await Purchases.getOfferings();
    const current = offerings.current ?? offerings.all?.["default"] ?? null;
    const pkg = current?.availablePackages?.find((item) => item.identifier === packageId);
    if (!pkg) return { status: "unavailable" };

    const result = await Purchases.purchasePackage({ aPackage: pkg });
    const state = await cacheEntitlement(toState(result.customerInfo));
    if (!state.isPremium) return { status: "pending" };
    analytics.track("purchase_success", { package: packageId });
    return { status: "success", state };
  } catch (error) {
    const err = error as { code?: string; message?: string; userCancelled?: boolean };
    if (err.userCancelled || /cancel/i.test(err.message ?? "")) {
      analytics.track("purchase_cancelled");
      return { status: "cancelled" };
    }
    if (/pending|deferred/i.test(err.message ?? "")) return { status: "pending" };
    analytics.error(error, { stage: "revenuecat_purchase" });
    return { status: "error", message: err.message ?? "Purchase failed" };
  }
}

/** Presents RevenueCat's native paywall and normalises every outcome. */
export async function presentPaywall(): Promise<PurchaseOutcome> {
  if (!isNative()) return { status: "unavailable" };
  try {
    await configureRevenueCat();
    const { Purchases } = await rc();
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages?.[0];
    if (!pkg) return { status: "unavailable" };

    const result = await Purchases.purchasePackage({ aPackage: pkg });
    const state = await cacheEntitlement(toState(result.customerInfo));
    if (!state.isPremium) return { status: "pending" };
    analytics.track("purchase_success");
    return { status: "success", state };
  } catch (error) {
    const err = error as { code?: string; message?: string; userCancelled?: boolean };
    if (err.userCancelled || /cancel/i.test(err.message ?? "")) {
      analytics.track("purchase_cancelled");
      return { status: "cancelled" };
    }
    if (/pending|deferred/i.test(err.message ?? "")) return { status: "pending" };
    analytics.error(error, { stage: "revenuecat_purchase" });
    return { status: "error", message: err.message ?? "Purchase failed" };
  }
}

export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!isNative()) return { status: "unavailable" };
  try {
    await configureRevenueCat();
    const { Purchases } = await rc();
    const { customerInfo } = await Purchases.restorePurchases();
    const state = await cacheEntitlement(toState(customerInfo));
    return { status: "success", state };
  } catch (error) {
    analytics.error(error, { stage: "revenuecat_restore" });
    return { status: "error", message: (error as Error).message };
  }
}