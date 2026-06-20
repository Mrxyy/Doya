import type { BillingUpgradeReason } from "@/stores/billing-upgrade-modal-store";
import { translateNow } from "@/i18n/i18n";

export function getBillingUpgradeReason(error: unknown): BillingUpgradeReason | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AI usage balance is exhausted")) {
    return "balance";
  }
  if (message.includes("Workspace storage limit is exceeded")) {
    return "storage";
  }
  if (message.includes("Uploaded file exceeds the single file limit")) {
    return "storage";
  }
  return null;
}

export function translateBillingError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Billing account is not active")) {
    return translateNow("billing.error.accountInactive");
  }
  if (message.includes("AI usage balance is exhausted")) {
    return translateNow("billing.error.balanceExhausted");
  }
  if (message.includes("Workspace storage limit is exceeded")) {
    return translateNow("billing.error.storageExceeded");
  }
  if (message.includes("Uploaded file exceeds the single file limit")) {
    return translateNow("billing.error.singleUploadExceeded");
  }
  return null;
}
