import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { DimensionValue } from "react-native";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { AdminAccessGate } from "@/components/admin-access-gate";
import { BackHeader } from "@/components/headers/back-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createControlAdminAdjustment,
  createControlAdminTopUp,
  getControlAdminBillingState,
  isControlApiConfigured,
  rescanControlAdminBillingStorage,
  updateControlBillingPlan,
  updateControlBillingPlanDefinition,
  updateControlBillingSettings,
  updateControlReferral,
  updateControlStorageQuota,
  upsertControlModelPricing,
  type ControlAdminBillingState,
  type ControlBillingStatus,
  type ControlModelPricingRecord,
  type ControlPlanId,
  type ControlPlanRecord,
  type ControlReferralStatus,
  type ControlUsageFilters,
} from "@/control/control-api";
import { useToast } from "@/contexts/toast-context";
import { useI18n } from "@/i18n/i18n";
import {
  BadgeDollarSign,
  Coins,
  Database,
  Gift,
  ListChecks,
  ReceiptText,
  Users,
} from "@/components/icons/lucide";

type BillingTab = "overview" | "pricing" | "usage" | "users" | "storage" | "referrals" | "settings";
type BillingIcon = ComponentType<{ size: number; color: string }>;

const EMPTY_PRICING_FORM = {
  id: "",
  providerId: "",
  modelId: "",
  displayName: "",
  inputPrice: "",
  outputPrice: "",
  cacheCreationPrice: "",
  cacheReadPrice: "",
  supportsUsageAccounting: true,
};

const PLAN_IDS: ControlPlanId[] = ["free", "pro"];
const BYTES_PER_MB = 1024 * 1024;

interface BillingSettingsDraft {
  usdToCnyRate: string;
  tokenMarkupMultiplier: string;
  freeMonthlyGrantCny: string;
  proMonthlyGrantCny: string;
  referralInviteeBonusCny: string;
  referralInviterRewardCny: string;
  referralDailyRewardLimit: string;
  referralMonthlyRewardLimit: string;
  referralRewardExpiresDays: string;
}

interface PlanSettingsDraft {
  priceCny: string;
  monthlyGrantCny: string;
  workspaceMbLimit: string;
  singleUploadMbLimit: string;
  enabled: boolean;
}

type PlanSettingsDrafts = Record<ControlPlanId, PlanSettingsDraft>;

export default function BillingAdminScreen() {
  useEffect(() => {
    router.replace("/admin/daemons");
  }, []);
  return null;
}

export function BillingAdminPanel({ framed = false }: { framed?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [state, setState] = useState<ControlAdminBillingState | null>(null);
  const [selectedTab, setSelectedTab] = useState<BillingTab>("overview");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingForm, setPricingForm] = useState(EMPTY_PRICING_FORM);
  const [adjustmentUserId, setAdjustmentUserId] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [storageUserId, setStorageUserId] = useState("");
  const [temporaryBytes, setTemporaryBytes] = useState("");
  const [usageFilters, setUsageFilters] = useState<ControlUsageFilters>({});
  const [settingsDraft, setSettingsDraft] = useState({
    usdToCnyRate: "",
    tokenMarkupMultiplier: "",
    freeMonthlyGrantCny: "",
    proMonthlyGrantCny: "",
    referralInviteeBonusCny: "",
    referralInviterRewardCny: "",
    referralDailyRewardLimit: "",
    referralMonthlyRewardLimit: "",
    referralRewardExpiresDays: "",
  });
  const [planDrafts, setPlanDrafts] = useState<PlanSettingsDrafts>(() => buildPlanDrafts([]));

  useEffect(() => {
    if (!framed) {
      setIsUnlocked(true);
    }
  }, [framed]);

  const load = useCallback(
    async (filters: ControlUsageFilters = usageFilters) => {
      if (!isControlApiConfigured()) {
        setError(t("admin.billing.error.notConfigured"));
        return;
      }
      setIsLoading(true);
      try {
        const stored = await loadAccountBootstrapSession();
        if (!stored || !stored.workspace.workspaceId.startsWith("control:")) {
          throw new Error(t("session.error.loginRequired"));
        }
        const nextState = await getControlAdminBillingState({ accountSession: stored, filters });
        setAccountSession(stored);
        setState(nextState);
        setSettingsDraft({
          usdToCnyRate: String(nextState.overview.settings.usdToCnyRate),
          tokenMarkupMultiplier: String(nextState.overview.settings.tokenMarkupMultiplier),
          freeMonthlyGrantCny: String(nextState.overview.settings.freeMonthlyGrantCny),
          proMonthlyGrantCny: String(nextState.overview.settings.proMonthlyGrantCny),
          referralInviteeBonusCny: String(nextState.overview.settings.referralInviteeBonusCny),
          referralInviterRewardCny: String(nextState.overview.settings.referralInviterRewardCny),
          referralDailyRewardLimit: String(nextState.overview.settings.referralDailyRewardLimit),
          referralMonthlyRewardLimit: String(
            nextState.overview.settings.referralMonthlyRewardLimit,
          ),
          referralRewardExpiresDays: String(nextState.overview.settings.referralRewardExpiresDays),
        });
        setPlanDrafts(buildPlanDrafts(nextState.plans));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsLoading(false);
      }
    },
    [t, usageFilters],
  );

  useEffect(() => {
    if (isUnlocked) {
      void load();
    }
  }, [isUnlocked, load]);

  const tabs = useMemo<Array<SegmentedControlOption<BillingTab>>>(
    () => [
      { value: "overview", label: t("admin.billing.tabs.overview") },
      { value: "pricing", label: t("admin.billing.tabs.pricing") },
      { value: "usage", label: t("admin.billing.tabs.usage") },
      { value: "users", label: t("admin.billing.tabs.users") },
      { value: "storage", label: t("admin.billing.tabs.storage") },
      { value: "referrals", label: t("admin.billing.tabs.referrals") },
      { value: "settings", label: t("admin.billing.tabs.settings") },
    ],
    [t],
  );
  const handleFramedBack = useCallback(() => {
    router.replace("/");
  }, []);
  const handleUnlockBilling = useCallback(() => {
    setIsUnlocked(true);
  }, []);
  const handleRetryLoad = useCallback(() => {
    void load();
  }, [load]);

  const handleSavePricing = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await upsertControlModelPricing({
        accountSession,
        pricing: {
          id: pricingForm.id || undefined,
          providerId: pricingForm.providerId,
          modelId: pricingForm.modelId,
          displayName: pricingForm.displayName,
          inputPriceUsdPerToken: Number(pricingForm.inputPrice),
          outputPriceUsdPerToken: Number(pricingForm.outputPrice),
          cacheCreationPriceUsdPerToken: Number(pricingForm.cacheCreationPrice),
          cacheReadPriceUsdPerToken: Number(pricingForm.cacheReadPrice),
          supportsUsageAccounting: pricingForm.supportsUsageAccounting,
        },
      });
      setPricingForm(EMPTY_PRICING_FORM);
      await load();
      toast.show(t("admin.billing.toast.pricingSaved"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, load, pricingForm, t, toast]);

  const handleEditPricing = useCallback((pricing: ControlModelPricingRecord) => {
    setPricingForm({
      id: pricing.id,
      providerId: pricing.providerId,
      modelId: pricing.modelId,
      displayName: pricing.displayName,
      inputPrice: String(pricing.inputPriceUsdPerToken),
      outputPrice: String(pricing.outputPriceUsdPerToken),
      cacheCreationPrice: String(pricing.cacheCreationPriceUsdPerToken),
      cacheReadPrice: String(pricing.cacheReadPriceUsdPerToken),
      supportsUsageAccounting: pricing.supportsUsageAccounting,
    });
  }, []);

  const handleTogglePricing = useCallback(
    async (pricing: ControlModelPricingRecord) => {
      if (!accountSession) {
        return;
      }
      setIsMutating(true);
      try {
        await upsertControlModelPricing({
          accountSession,
          pricing: {
            id: pricing.id,
            providerId: pricing.providerId,
            modelId: pricing.modelId,
            displayName: pricing.displayName,
            inputPriceUsdPerToken: pricing.inputPriceUsdPerToken,
            outputPriceUsdPerToken: pricing.outputPriceUsdPerToken,
            cacheCreationPriceUsdPerToken: pricing.cacheCreationPriceUsdPerToken,
            cacheReadPriceUsdPerToken: pricing.cacheReadPriceUsdPerToken,
            supportsUsageAccounting: pricing.supportsUsageAccounting,
            enabled: !pricing.enabled,
            source: pricing.source,
          },
        });
        await load();
        toast.show(t("admin.billing.toast.pricingSaved"));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, load, t, toast],
  );

  const handleAdjustment = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await createControlAdminAdjustment({
        accountSession,
        userId: adjustmentUserId,
        amountCny: Number(adjustmentAmount),
        note: t("admin.billing.adjustment.note"),
      });
      setAdjustmentAmount("");
      await load();
      toast.show(t("admin.billing.toast.adjusted"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, adjustmentAmount, adjustmentUserId, load, t, toast]);

  const handleTopUp = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await createControlAdminTopUp({
        accountSession,
        userId: adjustmentUserId,
        amountCny: Number(adjustmentAmount),
        note: t("admin.billing.topUp.note"),
      });
      setAdjustmentAmount("");
      await load();
      toast.show(t("admin.billing.toast.toppedUp"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, adjustmentAmount, adjustmentUserId, load, t, toast]);

  const handleSetPlan = useCallback(
    async (userId: string, planId: "free" | "pro") => {
      if (!accountSession) {
        return;
      }
      setIsMutating(true);
      try {
        await updateControlBillingPlan({ accountSession, userId, planId });
        await load();
        toast.show(t("admin.billing.toast.planUpdated"));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, load, t, toast],
  );

  const handleStorageUpdate = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await updateControlStorageQuota({
        accountSession,
        userId: storageUserId,
        temporaryWorkspaceBytesLimit: Number(temporaryBytes),
      });
      setTemporaryBytes("");
      await load();
      toast.show(t("admin.billing.toast.storageUpdated"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, load, storageUserId, t, temporaryBytes, toast]);

  const handleStorageRescan = useCallback(async () => {
    if (!accountSession || !storageUserId.trim()) {
      return;
    }
    setIsMutating(true);
    try {
      await rescanControlAdminBillingStorage({ accountSession, userId: storageUserId });
      await load();
      toast.show(t("admin.billing.toast.storageUpdated"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, load, storageUserId, t, toast]);

  const handleUsageFilter = useCallback(
    async (filters: ControlUsageFilters) => {
      setUsageFilters(filters);
      await load(filters);
    },
    [load],
  );

  const handleSaveSettings = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await updateControlBillingSettings({
        accountSession,
        settings: {
          usdToCnyRate: Number(settingsDraft.usdToCnyRate),
          tokenMarkupMultiplier: Number(settingsDraft.tokenMarkupMultiplier),
          freeMonthlyGrantCny: Number(planDrafts.free.monthlyGrantCny),
          proMonthlyGrantCny: Number(planDrafts.pro.monthlyGrantCny),
          referralInviteeBonusCny: Number(settingsDraft.referralInviteeBonusCny),
          referralInviterRewardCny: Number(settingsDraft.referralInviterRewardCny),
          referralDailyRewardLimit: Number(settingsDraft.referralDailyRewardLimit),
          referralMonthlyRewardLimit: Number(settingsDraft.referralMonthlyRewardLimit),
          referralRewardExpiresDays: Number(settingsDraft.referralRewardExpiresDays),
        },
      });
      await Promise.all(
        PLAN_IDS.map((planId) =>
          updateControlBillingPlanDefinition({
            accountSession,
            plan: {
              id: planId,
              priceCny: Number(planDrafts[planId].priceCny),
              monthlyGrantCny: Number(planDrafts[planId].monthlyGrantCny),
              workspaceBytesLimit: mbToBytes(planDrafts[planId].workspaceMbLimit),
              singleUploadBytesLimit: mbToBytes(planDrafts[planId].singleUploadMbLimit),
              enabled: planDrafts[planId].enabled,
            },
          }),
        ),
      );
      await load();
      toast.show(t("admin.billing.toast.settingsSaved"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, load, planDrafts, settingsDraft, t, toast]);

  const handleReferralStatus = useCallback(
    async (referralId: string, status: "rewarded" | "rejected") => {
      if (!accountSession) {
        return;
      }
      setIsMutating(true);
      try {
        await updateControlReferral({ accountSession, referralId, status });
        await load();
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, load, toast],
  );

  let contentBody: ReactNode = null;
  if (isLoading) {
    contentBody = (
      <View style={styles.center}>
        <LoadingSpinner color={styles.icon.color} />
      </View>
    );
  } else if (error) {
    contentBody = (
      <View style={styles.statePanel}>
        <Text style={styles.error}>{error}</Text>
        <Button variant="secondary" onPress={handleRetryLoad}>
          {t("common.loadMore")}
        </Button>
      </View>
    );
  } else if (state) {
    contentBody = (
      <View style={styles.content}>
        <SegmentedControl
          value={selectedTab}
          options={tabs}
          onValueChange={setSelectedTab}
          size="sm"
          style={styles.detailTabs}
        />
        {selectedTab === "overview" ? <OverviewTab state={state} /> : null}
        {selectedTab === "pricing" ? (
          <PricingTab
            pricing={state.pricing}
            form={pricingForm}
            setForm={setPricingForm}
            onSave={handleSavePricing}
            onEdit={handleEditPricing}
            onToggle={handleTogglePricing}
            isMutating={isMutating}
          />
        ) : null}
        {selectedTab === "usage" ? (
          <UsageTab state={state} filters={usageFilters} onFilter={handleUsageFilter} />
        ) : null}
        {selectedTab === "users" ? (
          <UsersTab
            state={state}
            userId={adjustmentUserId}
            amount={adjustmentAmount}
            setUserId={setAdjustmentUserId}
            setAmount={setAdjustmentAmount}
            onAdjust={handleAdjustment}
            onTopUp={handleTopUp}
            onSetPlan={handleSetPlan}
            isMutating={isMutating}
          />
        ) : null}
        {selectedTab === "storage" ? (
          <StorageTab
            state={state}
            userId={storageUserId}
            temporaryBytes={temporaryBytes}
            setUserId={setStorageUserId}
            setTemporaryBytes={setTemporaryBytes}
            onUpdate={handleStorageUpdate}
            onRescan={handleStorageRescan}
            isMutating={isMutating}
          />
        ) : null}
        {selectedTab === "referrals" ? (
          <ReferralsTab state={state} onStatus={handleReferralStatus} isMutating={isMutating} />
        ) : null}
        {selectedTab === "settings" ? (
          <SettingsTab
            draft={settingsDraft}
            setDraft={setSettingsDraft}
            planDrafts={planDrafts}
            setPlanDrafts={setPlanDrafts}
            onSave={handleSaveSettings}
            isMutating={isMutating}
          />
        ) : null}
      </View>
    );
  }

  const content = (
    <View style={framed ? styles.root : styles.embeddedRoot}>
      {framed ? <BackHeader title={t("admin.billing.title")} onBack={handleFramedBack} /> : null}
      {contentBody}
    </View>
  );

  if (!framed) {
    return content;
  }

  return <AdminAccessGate onUnlock={handleUnlockBilling}>{content}</AdminAccessGate>;
}

function OverviewTab({ state }: { state: ControlAdminBillingState }) {
  const { t } = useI18n();
  const totals = state.overview.totals;
  const settings = state.overview.settings;
  const enabledPricingCount = state.pricing.filter((entry) => entry.enabled).length;
  const paidUserRatio =
    state.users.length > 0 ? totals.activePaidUserCount / state.users.length : 0;
  const storageUsedBytes = state.storageQuotas.reduce(
    (sum, quota) => sum + quota.workspaceBytesUsed,
    0,
  );
  const storageLimitBytes = state.storageQuotas.reduce(
    (sum, quota) => sum + quota.workspaceBytesLimit,
    0,
  );
  const storageRatio = storageLimitBytes > 0 ? storageUsedBytes / storageLimitBytes : 0;
  const pendingReferralCount = state.referrals.filter(
    (referral) => referral.status !== "rewarded" && referral.status !== "rejected",
  ).length;
  const rewardedReferralCount = state.referrals.filter(
    (referral) => referral.status === "rewarded",
  ).length;
  const issueCount = totals.exhaustedUserCount + totals.storageExceededUserCount;

  return (
    <View style={styles.overviewTab}>
      <View style={styles.billingHero}>
        <View style={styles.billingHeroMain}>
          <View style={styles.billingAvatar}>
            <BadgeDollarSign size={20} color={styles.icon.color} />
          </View>
          <View style={styles.billingTitleBlock}>
            <View style={styles.billingTitleRow}>
              <Text style={styles.panelTitle}>{t("admin.billing.overview.revenue")}</Text>
              <StatusBadge
                label={
                  issueCount === 0
                    ? t("admin.billing.status.ok")
                    : t("admin.billing.status.attention")
                }
                variant={issueCount === 0 ? "success" : "error"}
              />
            </View>
            <Text style={styles.billingHeroValue}>{formatCny(totals.monthUsageChargeCny)}</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {`${t("admin.billing.metric.rmb")} ${formatCny(totals.totalRmbCost)} · ${t(
                "admin.billing.metric.usd",
              )} $${totals.totalUsdCost.toFixed(4)}`}
            </Text>
          </View>
        </View>
        <View style={styles.billingHeroActions}>
          <BillingSparkline />
          <OverviewProgress
            label={t("admin.billing.overview.paidUsers")}
            value={`${totals.activePaidUserCount}/${state.users.length}`}
            ratio={paidUserRatio}
          />
        </View>
      </View>
      <View style={styles.topologyStrip}>
        <MetricTile
          label={t("admin.billing.metric.tokens")}
          value={formatInteger(totals.totalTokens)}
        />
        <MetricTile
          label={t("admin.billing.metric.paidUsers")}
          value={totals.activePaidUserCount}
        />
        <MetricTile label={t("admin.billing.metric.exhausted")} value={totals.exhaustedUserCount} />
        <MetricTile
          label={t("admin.billing.metric.storageOver")}
          value={totals.storageExceededUserCount}
        />
      </View>
      <View style={styles.visualGrid}>
        <View style={styles.visualPanel}>
          <View style={styles.visualHeader}>
            <View style={styles.visualTitle}>
              <ListChecks size={16} color={styles.icon.color} />
              <Text style={styles.sectionTitleText}>
                {t("admin.billing.overview.usageRequests")}
              </Text>
            </View>
            <Text style={styles.visualValue}>{formatInteger(state.usage.requestCount)}</Text>
          </View>
          <View style={styles.resourceBars}>
            <OverviewMeter
              label={t("admin.billing.metric.rmb")}
              value={formatCny(state.usage.actualCostCny)}
              ratio={state.usage.actualCostCny / Math.max(totals.monthUsageChargeCny, 1)}
            />
            <OverviewMeter
              label={t("admin.billing.metric.tokens")}
              value={formatInteger(state.usage.totalTokens)}
              ratio={state.usage.totalTokens / Math.max(totals.totalTokens, 1)}
            />
          </View>
        </View>
        <View style={styles.visualPanel}>
          <View style={styles.visualHeader}>
            <View style={styles.visualTitle}>
              <Database size={16} color={styles.icon.color} />
              <Text style={styles.sectionTitleText}>{t("admin.billing.overview.storageUsed")}</Text>
            </View>
            <Text style={styles.visualValue}>{formatPercent(storageRatio)}</Text>
          </View>
          <View style={styles.resourceBars}>
            <OverviewMeter
              label={t("admin.billing.overview.storageUsed")}
              value={`${formatBytes(storageUsedBytes)} / ${formatBytes(storageLimitBytes)}`}
              ratio={storageRatio}
            />
            <OverviewMeter
              label={t("admin.billing.metric.storageOver")}
              value={String(totals.storageExceededUserCount)}
              ratio={totals.storageExceededUserCount / Math.max(state.storageQuotas.length, 1)}
            />
          </View>
        </View>
      </View>
      <View style={styles.controlDock}>
        <OverviewControlGroup
          icon={ReceiptText}
          label={t("admin.billing.overview.usageRequests")}
          value={formatInteger(state.usage.requestCount)}
          detail={formatCny(state.usage.actualCostCny)}
        />
        <OverviewControlGroup
          icon={ReceiptText}
          label={t("admin.billing.overview.enabledModels")}
          value={`${enabledPricingCount}/${state.pricing.length}`}
          detail={t("admin.billing.overview.pricingModels")}
        />
        <OverviewControlGroup
          icon={Gift}
          label={t("admin.billing.overview.referralPipeline")}
          value={String(pendingReferralCount)}
          detail={t("admin.billing.overview.rewardedReferrals", {
            count: rewardedReferralCount,
          })}
        />
        <OverviewControlGroup
          icon={Coins}
          label={t("admin.billing.metric.referralRewards")}
          value={formatCny(totals.referralRewardTotalCny)}
          detail={`${t("admin.billing.field.usdToCny")} ${settings.usdToCnyRate} · ${settings.tokenMarkupMultiplier}x`}
        />
      </View>
    </View>
  );
}

function OverviewProgress({
  label,
  value,
  ratio,
}: {
  label: string;
  value: string;
  ratio: number;
}) {
  const fillStyle = useMemo(
    () => ({ width: `${Math.round(clamp01(ratio) * 100)}%` as DimensionValue }),
    [ratio],
  );
  const progressFillStyle = useMemo(() => [styles.overviewProgressFill, fillStyle], [fillStyle]);
  return (
    <View style={styles.overviewProgress}>
      <View style={styles.overviewProgressHeader}>
        <Text style={styles.healthLabel}>{label}</Text>
        <Text style={styles.healthValue}>{value}</Text>
      </View>
      <View style={styles.overviewProgressTrack}>
        <View style={progressFillStyle} />
      </View>
    </View>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricTileAccent} />
      <Text style={styles.metricTileValue} numberOfLines={1}>
        {String(value)}
      </Text>
      <Text style={styles.metricTileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function BillingSparkline() {
  return (
    <View style={styles.sparklineCard}>
      <View style={styles.sparklineHeader}>
        <View style={styles.sparklineDot} />
        <View style={styles.sparklineDash} />
      </View>
      <View style={styles.sparklineBars}>
        <View style={styles.sparklineBarTiny} />
        <View style={styles.sparklineBarSmall} />
        <View style={styles.sparklineBarTall} />
        <View style={styles.sparklineBarMedium} />
        <View style={styles.sparklineBarPeak} />
      </View>
    </View>
  );
}

function OverviewMeter({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  const fillStyle = useMemo(
    () => ({ width: `${Math.round(clamp01(ratio) * 100)}%` as DimensionValue }),
    [ratio],
  );
  const meterFillStyle = useMemo(() => [styles.overviewProgressFill, fillStyle], [fillStyle]);
  return (
    <View style={styles.resourceRow}>
      <View style={styles.resourceLabel}>
        <Text style={styles.metricTileLabel}>{label}</Text>
      </View>
      <View style={styles.resourceMeter}>
        <View style={styles.usageTrack}>
          <View style={meterFillStyle} />
        </View>
        <Text style={styles.resourceValue}>{value}</Text>
      </View>
    </View>
  );
}

function OverviewControlGroup({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: BillingIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View style={styles.controlDockGroup}>
      <View style={styles.controlDockTitle}>
        <Icon size={15} color={styles.icon.color} />
        <Text style={styles.sectionTitleText}>{label}</Text>
      </View>
      <View style={styles.controlMetricRow}>
        <Text style={styles.controlMetricValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

function PricingTab({
  pricing,
  form,
  setForm,
  onSave,
  onEdit,
  onToggle,
  isMutating,
}: {
  pricing: ControlModelPricingRecord[];
  form: typeof EMPTY_PRICING_FORM;
  setForm: (value: typeof EMPTY_PRICING_FORM) => void;
  onSave: () => void;
  onEdit: (pricing: ControlModelPricingRecord) => void;
  onToggle: (pricing: ControlModelPricingRecord) => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const handleProviderIdChange = useCallback(
    (providerId: string) => setForm({ ...form, providerId }),
    [form, setForm],
  );
  const handleModelIdChange = useCallback(
    (modelId: string) => setForm({ ...form, modelId }),
    [form, setForm],
  );
  const handleDisplayNameChange = useCallback(
    (displayName: string) => setForm({ ...form, displayName }),
    [form, setForm],
  );
  const handleInputPriceChange = useCallback(
    (inputPrice: string) => setForm({ ...form, inputPrice }),
    [form, setForm],
  );
  const handleOutputPriceChange = useCallback(
    (outputPrice: string) => setForm({ ...form, outputPrice }),
    [form, setForm],
  );
  const handleCacheCreationPriceChange = useCallback(
    (cacheCreationPrice: string) => setForm({ ...form, cacheCreationPrice }),
    [form, setForm],
  );
  const handleCacheReadPriceChange = useCallback(
    (cacheReadPrice: string) => setForm({ ...form, cacheReadPrice }),
    [form, setForm],
  );
  const handleUsageAccountingToggle = useCallback(() => {
    setForm({ ...form, supportsUsageAccounting: !form.supportsUsageAccounting });
  }, [form, setForm]);

  return (
    <View style={styles.stack}>
      <View style={styles.tabPanel}>
        <View style={styles.tabPanelHeader}>
          <PanelHeading
            icon={ReceiptText}
            title={t("admin.billing.tabs.pricing")}
            detail={`${pricing.length} ${t("admin.billing.overview.pricingModels")}`}
          />
          <View style={styles.inlineActions}>
            <Button variant="secondary" size="sm" onPress={handleUsageAccountingToggle}>
              {form.supportsUsageAccounting
                ? t("admin.billing.status.usageAccountingEnabled")
                : t("admin.billing.status.usageAccountingDisabled")}
            </Button>
            <Button variant="default" size="sm" onPress={onSave} disabled={isMutating}>
              {t("admin.billing.action.savePricing")}
            </Button>
          </View>
        </View>
        <View style={styles.inlineFormGrid}>
          <Field
            value={form.providerId}
            placeholder={t("admin.billing.field.providerId")}
            onChangeText={handleProviderIdChange}
          />
          <Field
            value={form.modelId}
            placeholder={t("admin.billing.field.modelId")}
            onChangeText={handleModelIdChange}
          />
          <Field
            value={form.displayName}
            placeholder={t("admin.billing.field.displayName")}
            onChangeText={handleDisplayNameChange}
          />
          <Field
            value={form.inputPrice}
            placeholder={t("admin.billing.field.inputPrice")}
            onChangeText={handleInputPriceChange}
          />
          <Field
            value={form.outputPrice}
            placeholder={t("admin.billing.field.outputPrice")}
            onChangeText={handleOutputPriceChange}
          />
          <Field
            value={form.cacheCreationPrice}
            placeholder={t("admin.billing.field.cacheCreationPrice")}
            onChangeText={handleCacheCreationPriceChange}
          />
          <Field
            value={form.cacheReadPrice}
            placeholder={t("admin.billing.field.cacheReadPrice")}
            onChangeText={handleCacheReadPriceChange}
          />
        </View>
      </View>
      <AdminTable
        left={t("admin.billing.table.model")}
        middle={t("admin.billing.table.price")}
        right={t("admin.billing.table.status")}
        emptyLabel={pricing.length === 0 ? t("admin.billing.empty.pricing") : null}
      >
        {pricing.map((entry) => (
          <PricingTableRow
            key={entry.id}
            entry={entry}
            onEdit={onEdit}
            onToggle={onToggle}
            isMutating={isMutating}
          />
        ))}
      </AdminTable>
    </View>
  );
}

function PricingTableRow({
  entry,
  onEdit,
  onToggle,
  isMutating,
}: {
  entry: ControlModelPricingRecord;
  onEdit: (pricing: ControlModelPricingRecord) => void;
  onToggle: (pricing: ControlModelPricingRecord) => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const handleEditPress = useCallback(() => {
    onEdit(entry);
  }, [entry, onEdit]);
  const handleTogglePress = useCallback(() => {
    onToggle(entry);
  }, [entry, onToggle]);

  return (
    <View style={styles.tableRow}>
      <View style={styles.tableLeft}>
        <Text style={styles.rowTitle}>{`${entry.providerId}/${entry.modelId}`}</Text>
        <Text style={styles.rowDetail}>{entry.displayName}</Text>
      </View>
      <PriceBreakdown entry={entry} />
      <View style={styles.tableRightActions}>
        <StatusBadge
          label={
            entry.enabled ? t("admin.billing.status.enabled") : t("admin.billing.status.disabled")
          }
          variant={entry.enabled ? "success" : "muted"}
        />
        <StatusBadge
          label={
            entry.supportsUsageAccounting
              ? t("admin.billing.status.usageAccountingEnabled")
              : t("admin.billing.status.usageAccountingDisabled")
          }
          variant={entry.supportsUsageAccounting ? "success" : "error"}
        />
        <Button variant="outline" size="sm" onPress={handleEditPress}>
          {t("admin.billing.action.edit")}
        </Button>
        <Button variant="outline" size="sm" onPress={handleTogglePress} disabled={isMutating}>
          {entry.enabled ? t("admin.billing.action.disable") : t("admin.billing.action.enable")}
        </Button>
      </View>
    </View>
  );
}

function UsageTab({
  state,
  filters,
  onFilter,
}: {
  state: ControlAdminBillingState;
  filters: ControlUsageFilters;
  onFilter: (filters: ControlUsageFilters) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ControlUsageFilters>(filters);
  const handleUserIdChange = useCallback(
    (userId: string) => setDraft({ ...draft, userId }),
    [draft],
  );
  const handleSessionIdChange = useCallback(
    (sessionId: string) => setDraft({ ...draft, sessionId }),
    [draft],
  );
  const handleProviderIdChange = useCallback(
    (providerId: string) => setDraft({ ...draft, providerId }),
    [draft],
  );
  const handleModelIdChange = useCallback(
    (modelId: string) => setDraft({ ...draft, modelId }),
    [draft],
  );
  const handlePlanIdChange = useCallback(
    (planId: string) => setDraft({ ...draft, planId }),
    [draft],
  );
  const handleStartAtChange = useCallback(
    (startAt: string) => setDraft({ ...draft, startAt }),
    [draft],
  );
  const handleEndAtChange = useCallback((endAt: string) => setDraft({ ...draft, endAt }), [draft]);
  const handleApplyFilters = useCallback(() => {
    onFilter(draft);
  }, [draft, onFilter]);

  return (
    <View style={styles.stack}>
      <View style={styles.topologyStrip}>
        <MetricTile label={t("admin.billing.metric.requests")} value={state.usage.requestCount} />
        <MetricTile
          label={t("admin.billing.metric.tokens")}
          value={formatInteger(state.usage.totalTokens)}
        />
        <MetricTile
          label={t("admin.billing.metric.rmb")}
          value={formatCny(state.usage.actualCostCny)}
        />
        <MetricTile
          label={t("admin.billing.metric.usd")}
          value={`$${state.usage.markedCostUsd.toFixed(4)}`}
        />
      </View>
      <View style={styles.tabPanel}>
        <View style={styles.tabPanelHeader}>
          <PanelHeading
            icon={ListChecks}
            title={t("admin.billing.tabs.usage")}
            detail={t("admin.billing.action.applyFilters")}
          />
          <Button variant="secondary" size="sm" onPress={handleApplyFilters}>
            {t("admin.billing.action.applyFilters")}
          </Button>
        </View>
        <View style={styles.inlineFormGrid}>
          <Field
            value={draft.userId ?? ""}
            placeholder={t("admin.billing.field.userId")}
            onChangeText={handleUserIdChange}
          />
          <Field
            value={draft.sessionId ?? ""}
            placeholder={t("admin.billing.field.sessionId")}
            onChangeText={handleSessionIdChange}
          />
          <Field
            value={draft.providerId ?? ""}
            placeholder={t("admin.billing.field.providerId")}
            onChangeText={handleProviderIdChange}
          />
          <Field
            value={draft.modelId ?? ""}
            placeholder={t("admin.billing.field.modelId")}
            onChangeText={handleModelIdChange}
          />
          <Field
            value={draft.planId ?? ""}
            placeholder={t("admin.billing.field.planId")}
            onChangeText={handlePlanIdChange}
          />
          <Field
            value={draft.startAt ?? ""}
            placeholder={t("admin.billing.field.startAt")}
            onChangeText={handleStartAtChange}
          />
          <Field
            value={draft.endAt ?? ""}
            placeholder={t("admin.billing.field.endAt")}
            onChangeText={handleEndAtChange}
          />
        </View>
      </View>
      <AdminTable
        left={t("admin.billing.table.request")}
        middle={t("admin.billing.table.tokens")}
        right={t("admin.billing.table.cost")}
      >
        {state.usageLogs.slice(0, 40).map((log) => (
          <View key={log.id} style={styles.tableRow}>
            <View style={styles.tableLeft}>
              <Text style={styles.rowTitle}>{`${log.providerId}/${log.modelId}`}</Text>
              <Text
                style={styles.rowDetail}
              >{`${log.status} · ${formatDateTime(log.createdAt)} · ${formatShortId(log.agentId)}`}</Text>
            </View>
            <Text style={styles.tableMiddle}>
              {formatInteger(
                log.inputTokens + log.outputTokens + log.cacheCreationTokens + log.cacheReadTokens,
              )}
            </Text>
            <Text style={styles.tableRightText}>{formatCny(log.actualCostCny)}</Text>
          </View>
        ))}
      </AdminTable>
    </View>
  );
}

function UsersTab({
  state,
  userId,
  amount,
  setUserId,
  setAmount,
  onAdjust,
  onTopUp,
  onSetPlan,
  isMutating,
}: {
  state: ControlAdminBillingState;
  userId: string;
  amount: string;
  setUserId: (value: string) => void;
  setAmount: (value: string) => void;
  onAdjust: () => void;
  onTopUp: () => void;
  onSetPlan: (userId: string, planId: "free" | "pro") => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.stack}>
      <View style={styles.tabPanel}>
        <View style={styles.tabPanelHeader}>
          <PanelHeading
            icon={Users}
            title={t("admin.billing.tabs.users")}
            detail={`${state.users.length}`}
          />
          <View style={styles.inlineActions}>
            <Button variant="secondary" size="sm" onPress={onAdjust} disabled={isMutating}>
              {t("admin.billing.action.adjust")}
            </Button>
            <Button variant="secondary" size="sm" onPress={onTopUp} disabled={isMutating}>
              {t("admin.billing.action.topUp")}
            </Button>
          </View>
        </View>
        <View style={styles.inlineFormGrid}>
          <Field
            value={userId}
            placeholder={t("admin.billing.field.userId")}
            onChangeText={setUserId}
          />
          <Field
            value={amount}
            placeholder={t("admin.billing.field.amountCny")}
            onChangeText={setAmount}
          />
        </View>
      </View>
      <AdminTable
        left={t("admin.billing.table.user")}
        middle={t("admin.billing.table.balance")}
        right={t("admin.billing.table.actions")}
      >
        {state.users.map((entry) => (
          <UserBillingTableRow
            key={entry.user.id}
            entry={entry}
            onSetPlan={onSetPlan}
            isMutating={isMutating}
          />
        ))}
      </AdminTable>
    </View>
  );
}

function UserBillingTableRow({
  entry,
  onSetPlan,
  isMutating,
}: {
  entry: ControlAdminBillingState["users"][number];
  onSetPlan: (userId: string, planId: "free" | "pro") => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const nextPlanId = entry.account.planId === "pro" ? "free" : "pro";
  const handlePlanPress = useCallback(() => {
    onSetPlan(entry.user.id, nextPlanId);
  }, [entry.user.id, nextPlanId, onSetPlan]);

  return (
    <View style={styles.tableRow}>
      <View style={styles.tableLeft}>
        <Text style={styles.rowTitle}>{entry.user.email}</Text>
        <Text style={styles.rowDetail}>{`${entry.account.planId} · ${entry.account.status}`}</Text>
      </View>
      <View style={styles.tableMiddleStack}>
        <Text style={styles.tableStrong}>{formatCny(entry.balanceCny)}</Text>
        <Text style={styles.rowDetail}>{formatShortId(entry.user.id)}</Text>
      </View>
      <View style={styles.tableRightActions}>
        <StatusBadge
          label={entry.account.status}
          variant={billingAccountStatusVariant(entry.account.status)}
        />
        <Button variant="outline" size="sm" onPress={handlePlanPress} disabled={isMutating}>
          {nextPlanId === "pro"
            ? t("admin.billing.action.setProPlan")
            : t("admin.billing.action.setFreePlan")}
        </Button>
      </View>
    </View>
  );
}

function StorageTab({
  state,
  userId,
  temporaryBytes,
  setUserId,
  setTemporaryBytes,
  onUpdate,
  onRescan,
  isMutating,
}: {
  state: ControlAdminBillingState;
  userId: string;
  temporaryBytes: string;
  setUserId: (value: string) => void;
  setTemporaryBytes: (value: string) => void;
  onUpdate: () => void;
  onRescan: () => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const userLabelsById = useMemo(
    () => new Map(state.users.map((entry) => [entry.user.id, entry.user.email])),
    [state.users],
  );
  return (
    <View style={styles.stack}>
      <View style={styles.tabPanel}>
        <View style={styles.tabPanelHeader}>
          <PanelHeading
            icon={Database}
            title={t("admin.billing.tabs.storage")}
            detail={`${state.storageQuotas.length}`}
          />
          <View style={styles.inlineActions}>
            <Button variant="secondary" size="sm" onPress={onUpdate} disabled={isMutating}>
              {t("admin.billing.action.updateStorage")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onPress={onRescan}
              disabled={isMutating || !userId.trim()}
            >
              {t("admin.billing.action.rescanStorage")}
            </Button>
          </View>
        </View>
        <View style={styles.inlineFormGrid}>
          <Field
            value={userId}
            placeholder={t("admin.billing.field.userId")}
            onChangeText={setUserId}
          />
          <Field
            value={temporaryBytes}
            placeholder={t("admin.billing.field.temporaryBytes")}
            onChangeText={setTemporaryBytes}
          />
        </View>
      </View>
      <AdminTable
        left={t("admin.billing.table.userWorkspace")}
        middle={t("admin.billing.table.storage")}
        right={t("admin.billing.table.updated")}
      >
        {state.storageQuotas.map((quota, index) => {
          const userLabel =
            userLabelsById.get(quota.userId) ??
            t("admin.billing.user.fallback", { number: index + 1 });
          return (
            <View key={quota.id} style={styles.tableRow}>
              <View style={styles.tableLeft}>
                <Text style={styles.rowTitle}>{userLabel}</Text>
                <Text style={styles.rowDetail}>
                  {`${t("billing.storage.uploaded", { size: formatBytes(quota.uploadedBytesUsed) })} · ${t("billing.storage.generated", { size: formatBytes(quota.generatedBytesUsed) })} · ${formatShortId(quota.userId)}`}
                </Text>
              </View>
              <Text style={styles.tableMiddle}>
                {`${formatBytes(quota.workspaceBytesUsed)} / ${formatBytes(quota.workspaceBytesLimit)}`}
              </Text>
              <Text style={styles.tableRightText}>
                {quota.lastScannedAt ? new Date(quota.lastScannedAt).toLocaleDateString() : "-"}
              </Text>
            </View>
          );
        })}
      </AdminTable>
    </View>
  );
}

function ReferralsTab({
  state,
  onStatus,
  isMutating,
}: {
  state: ControlAdminBillingState;
  onStatus: (referralId: string, status: "rewarded" | "rejected") => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const rewardedCount = state.referrals.filter((referral) => referral.status === "rewarded").length;
  const pendingCount = state.referrals.length - rewardedCount;
  return (
    <View style={styles.stack}>
      <View style={styles.topologyStrip}>
        <MetricTile label={t("admin.billing.tabs.referrals")} value={state.referrals.length} />
        <MetricTile label={t("billing.referral.rewarded")} value={rewardedCount} />
        <MetricTile label={t("admin.billing.status.pending")} value={pendingCount} />
        <MetricTile
          label={t("admin.billing.metric.referralRewards")}
          value={formatCny(state.overview.totals.referralRewardTotalCny)}
        />
      </View>
      <AdminTable
        left={t("admin.billing.table.referral")}
        middle={t("admin.billing.table.status")}
        right={t("admin.billing.table.actions")}
      >
        {state.referrals.map((referral) => (
          <ReferralTableRow
            key={referral.id}
            referral={referral}
            onStatus={onStatus}
            isMutating={isMutating}
          />
        ))}
      </AdminTable>
    </View>
  );
}

function ReferralTableRow({
  referral,
  onStatus,
  isMutating,
}: {
  referral: ControlAdminBillingState["referrals"][number];
  onStatus: (referralId: string, status: "rewarded" | "rejected") => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const handleRewardPress = useCallback(() => {
    onStatus(referral.id, "rewarded");
  }, [onStatus, referral.id]);
  const handleRejectPress = useCallback(() => {
    onStatus(referral.id, "rejected");
  }, [onStatus, referral.id]);
  const referralDetail = [
    referral.sourceFingerprint
      ? `${t("admin.billing.referral.source")} ${referral.sourceFingerprint}`
      : null,
    referral.rejectReason
      ? `${t("admin.billing.referral.rejectReason")} ${referral.rejectReason}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.tableRow}>
      <View style={styles.tableLeft}>
        <Text style={styles.rowTitle}>{referral.code}</Text>
        <Text style={styles.rowDetail}>
          {`${formatShortId(referral.inviterUserId)} -> ${
            referral.inviteeUserId
              ? formatShortId(referral.inviteeUserId)
              : t("admin.billing.status.pending")
          }`}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {referralDetail}
        </Text>
      </View>
      <View style={styles.tableMiddleStack}>
        <StatusBadge label={referral.status} variant={referralStatusVariant(referral.status)} />
      </View>
      <View style={styles.tableRightActions}>
        <Button variant="outline" size="sm" onPress={handleRewardPress} disabled={isMutating}>
          {t("admin.billing.action.reward")}
        </Button>
        <Button variant="outline" size="sm" onPress={handleRejectPress} disabled={isMutating}>
          {t("admin.billing.action.reject")}
        </Button>
      </View>
    </View>
  );
}

function SettingsTab({
  draft,
  setDraft,
  planDrafts,
  setPlanDrafts,
  onSave,
  isMutating,
}: {
  draft: BillingSettingsDraft;
  setDraft: (value: BillingSettingsDraft) => void;
  planDrafts: PlanSettingsDrafts;
  setPlanDrafts: (value: PlanSettingsDrafts) => void;
  onSave: () => void;
  isMutating: boolean;
}) {
  const { t } = useI18n();
  const handleUsdToCnyRateChange = useCallback(
    (usdToCnyRate: string) => setDraft({ ...draft, usdToCnyRate }),
    [draft, setDraft],
  );
  const handleTokenMarkupMultiplierChange = useCallback(
    (tokenMarkupMultiplier: string) => setDraft({ ...draft, tokenMarkupMultiplier }),
    [draft, setDraft],
  );
  const handleReferralInviteeBonusCnyChange = useCallback(
    (referralInviteeBonusCny: string) => setDraft({ ...draft, referralInviteeBonusCny }),
    [draft, setDraft],
  );
  const handleReferralInviterRewardCnyChange = useCallback(
    (referralInviterRewardCny: string) => setDraft({ ...draft, referralInviterRewardCny }),
    [draft, setDraft],
  );
  const handleReferralDailyRewardLimitChange = useCallback(
    (referralDailyRewardLimit: string) => setDraft({ ...draft, referralDailyRewardLimit }),
    [draft, setDraft],
  );
  const handleReferralMonthlyRewardLimitChange = useCallback(
    (referralMonthlyRewardLimit: string) => setDraft({ ...draft, referralMonthlyRewardLimit }),
    [draft, setDraft],
  );
  const handleReferralRewardExpiresDaysChange = useCallback(
    (referralRewardExpiresDays: string) => setDraft({ ...draft, referralRewardExpiresDays }),
    [draft, setDraft],
  );

  return (
    <View style={styles.settingsPage}>
      <View style={styles.settingsGrid}>
        <SettingsGroup
          icon={BadgeDollarSign}
          title={t("admin.billing.settings.group.billing")}
          detail={t("admin.billing.settings.group.billingDetail")}
        >
          <SettingsField
            label={t("admin.billing.field.usdToCny")}
            hint={t("admin.billing.hint.usdToCny")}
            value={draft.usdToCnyRate}
            suffix={t("admin.billing.unit.rate")}
            placeholder={t("admin.billing.field.usdToCny")}
            onChangeText={handleUsdToCnyRateChange}
          />
          <SettingsField
            label={t("admin.billing.field.tokenMarkup")}
            hint={t("admin.billing.hint.tokenMarkup")}
            value={draft.tokenMarkupMultiplier}
            suffix="x"
            placeholder={t("admin.billing.field.tokenMarkup")}
            onChangeText={handleTokenMarkupMultiplierChange}
          />
        </SettingsGroup>

        <SettingsGroup
          icon={Coins}
          title={t("admin.billing.settings.group.plans")}
          detail={t("admin.billing.settings.group.plansDetail")}
          wide
        >
          <View style={styles.planSettingsGrid}>
            {PLAN_IDS.map((planId) => (
              <PlanSettingsCard
                key={planId}
                planId={planId}
                draft={planDrafts[planId]}
                setPlanDrafts={setPlanDrafts}
                planDrafts={planDrafts}
              />
            ))}
          </View>
        </SettingsGroup>

        <SettingsGroup
          icon={Gift}
          title={t("admin.billing.settings.group.referrals")}
          detail={t("admin.billing.settings.group.referralsDetail")}
          wide
        >
          <SettingsField
            label={t("admin.billing.field.referralInviteeBonus")}
            hint={t("admin.billing.hint.referralInviteeBonus")}
            value={draft.referralInviteeBonusCny}
            suffix="CNY"
            placeholder={t("admin.billing.field.referralInviteeBonus")}
            onChangeText={handleReferralInviteeBonusCnyChange}
          />
          <SettingsField
            label={t("admin.billing.field.referralInviterReward")}
            hint={t("admin.billing.hint.referralInviterReward")}
            value={draft.referralInviterRewardCny}
            suffix="CNY"
            placeholder={t("admin.billing.field.referralInviterReward")}
            onChangeText={handleReferralInviterRewardCnyChange}
          />
          <SettingsField
            label={t("admin.billing.field.referralDailyLimit")}
            hint={t("admin.billing.hint.referralDailyLimit")}
            value={draft.referralDailyRewardLimit}
            suffix={t("admin.billing.unit.times")}
            placeholder={t("admin.billing.field.referralDailyLimit")}
            onChangeText={handleReferralDailyRewardLimitChange}
          />
          <SettingsField
            label={t("admin.billing.field.referralMonthlyLimit")}
            hint={t("admin.billing.hint.referralMonthlyLimit")}
            value={draft.referralMonthlyRewardLimit}
            suffix={t("admin.billing.unit.times")}
            placeholder={t("admin.billing.field.referralMonthlyLimit")}
            onChangeText={handleReferralMonthlyRewardLimitChange}
          />
          <SettingsField
            label={t("admin.billing.field.referralExpiresDays")}
            hint={t("admin.billing.hint.referralExpiresDays")}
            value={draft.referralRewardExpiresDays}
            suffix={t("admin.billing.unit.days")}
            placeholder={t("admin.billing.field.referralExpiresDays")}
            onChangeText={handleReferralRewardExpiresDaysChange}
          />
        </SettingsGroup>
      </View>
      <View style={styles.settingsActions}>
        <Button variant="default" onPress={onSave} disabled={isMutating}>
          {t("admin.billing.action.saveSettings")}
        </Button>
      </View>
    </View>
  );
}

function PlanSettingsCard({
  planId,
  draft,
  planDrafts,
  setPlanDrafts,
}: {
  planId: ControlPlanId;
  draft: PlanSettingsDraft;
  planDrafts: PlanSettingsDrafts;
  setPlanDrafts: (value: PlanSettingsDrafts) => void;
}) {
  const { t } = useI18n();
  const updatePlanDraft = useCallback(
    (patch: Partial<PlanSettingsDraft>) => {
      setPlanDrafts({
        ...planDrafts,
        [planId]: {
          ...draft,
          ...patch,
        },
      });
    },
    [draft, planDrafts, planId, setPlanDrafts],
  );
  const handlePriceChange = useCallback(
    (priceCny: string) => updatePlanDraft({ priceCny }),
    [updatePlanDraft],
  );
  const handleMonthlyGrantChange = useCallback(
    (monthlyGrantCny: string) => updatePlanDraft({ monthlyGrantCny }),
    [updatePlanDraft],
  );
  const handleWorkspaceChange = useCallback(
    (workspaceMbLimit: string) => updatePlanDraft({ workspaceMbLimit }),
    [updatePlanDraft],
  );
  const handleSingleUploadChange = useCallback(
    (singleUploadMbLimit: string) => updatePlanDraft({ singleUploadMbLimit }),
    [updatePlanDraft],
  );
  const handleToggleEnabled = useCallback(() => {
    updatePlanDraft({ enabled: !draft.enabled });
  }, [draft.enabled, updatePlanDraft]);
  const planLabel =
    planId === "pro" ? t("admin.billing.action.proPlan") : t("admin.billing.action.freePlan");
  const cardStyle = useMemo(
    () => (planId === "pro" ? styles.planSettingsCardPro : styles.planSettingsCard),
    [planId],
  );

  return (
    <View style={cardStyle}>
      <View style={styles.planSettingsCardHeader}>
        <View>
          <Text style={styles.planSettingsEyebrow}>{t("admin.billing.field.planId")}</Text>
          <Text style={styles.planSettingsName}>{planLabel}</Text>
        </View>
        <Button variant={draft.enabled ? "secondary" : "outline"} onPress={handleToggleEnabled}>
          {draft.enabled ? t("admin.billing.status.enabled") : t("admin.billing.status.disabled")}
        </Button>
      </View>
      <View style={styles.settingsFieldGrid}>
        <SettingsField
          label={t("admin.billing.field.planPrice")}
          hint={t("admin.billing.hint.planPrice")}
          value={draft.priceCny}
          suffix="CNY"
          placeholder={t("admin.billing.field.planPrice")}
          onChangeText={handlePriceChange}
        />
        <SettingsField
          label={t("admin.billing.field.monthlyGrant")}
          hint={t("admin.billing.hint.monthlyGrant")}
          value={draft.monthlyGrantCny}
          suffix="CNY"
          placeholder={t("admin.billing.field.monthlyGrant")}
          onChangeText={handleMonthlyGrantChange}
        />
        <SettingsField
          label={t("admin.billing.field.workspaceLimit")}
          hint={t("admin.billing.hint.workspaceLimit")}
          value={draft.workspaceMbLimit}
          suffix={t("admin.billing.unit.mb")}
          placeholder={t("admin.billing.field.workspaceLimit")}
          onChangeText={handleWorkspaceChange}
        />
        <SettingsField
          label={t("admin.billing.field.singleUploadLimit")}
          hint={t("admin.billing.hint.singleUploadLimit")}
          value={draft.singleUploadMbLimit}
          suffix={t("admin.billing.unit.mb")}
          placeholder={t("admin.billing.field.singleUploadLimit")}
          onChangeText={handleSingleUploadChange}
        />
      </View>
    </View>
  );
}

function SettingsGroup({
  icon: Icon,
  title,
  detail,
  children,
  wide = false,
}: {
  icon: BillingIcon;
  title: string;
  detail: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const groupStyle = useMemo(
    () => (wide ? styles.settingsGroupWide : styles.settingsGroup),
    [wide],
  );
  return (
    <View style={groupStyle}>
      <View style={styles.settingsGroupHeader}>
        <View style={styles.settingsGroupIcon}>
          <Icon size={17} color={styles.accentIcon.color} />
        </View>
        <View style={styles.settingsGroupCopy}>
          <Text style={styles.settingsGroupTitle}>{title}</Text>
          <Text style={styles.settingsGroupDetail}>{detail}</Text>
        </View>
      </View>
      <View style={styles.settingsFieldGrid}>{children}</View>
    </View>
  );
}

function SettingsField({
  label,
  hint,
  value,
  suffix,
  placeholder,
  onChangeText,
}: {
  label: string;
  hint: string;
  value: string;
  suffix: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const inputStyle = useMemo(
    () => (isFocused ? styles.settingsInputFocused : styles.settingsInput),
    [isFocused],
  );
  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);
  return (
    <View style={styles.settingsField}>
      <View style={styles.settingsFieldTop}>
        <Text style={styles.settingsFieldLabel}>{label}</Text>
        <Text style={styles.settingsFieldSuffix}>{suffix}</Text>
      </View>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="decimal-pad"
        style={inputStyle}
      />
      <Text style={styles.settingsFieldHint}>{hint}</Text>
    </View>
  );
}

function PanelHeading({
  icon: Icon,
  title,
  detail,
}: {
  icon: BillingIcon;
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.panelHeading}>
      <View style={styles.controlDockTitle}>
        <View style={styles.panelHeadingIcon}>
          <Icon size={15} color={styles.accentIcon.color} />
        </View>
        <Text style={styles.sectionTitleText}>{title}</Text>
      </View>
      <Text style={styles.rowDetail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function AdminTableHeader({
  left,
  middle,
  right,
}: {
  left: string;
  middle: string;
  right: string;
}) {
  return (
    <View style={styles.tableHeader}>
      <Text style={styles.tableHeaderLeft}>{left}</Text>
      <Text style={styles.tableHeaderMiddle}>{middle}</Text>
      <Text style={styles.tableHeaderRight}>{right}</Text>
    </View>
  );
}

function AdminTable({
  left,
  middle,
  right,
  children,
  emptyLabel,
}: {
  left: string;
  middle: string;
  right: string;
  children: ReactNode;
  emptyLabel?: string | null;
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableAccentRail}>
        <View style={styles.tableAccentGreen} />
        <View style={styles.tableAccentBlue} />
        <View style={styles.tableAccentGold} />
      </View>
      <AdminTableHeader left={left} middle={middle} right={right} />
      <ScrollView style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
        {emptyLabel ? <EmptyAdminText label={emptyLabel} /> : null}
        {children}
      </ScrollView>
    </View>
  );
}

function EmptyAdminText({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIllustration}>
        <View style={styles.emptyCoinLarge} />
        <View style={styles.emptyCoinSmall} />
        <View style={styles.emptyLine} />
      </View>
      <Text style={styles.empty}>{label}</Text>
    </View>
  );
}

function PriceBreakdown({ entry }: { entry: ControlModelPricingRecord }) {
  const { t } = useI18n();
  return (
    <View style={styles.priceBreakdown}>
      <PriceLine
        label={t("admin.billing.price.input")}
        value={formatUsdPerMillion(entry.inputPriceUsdPerToken)}
      />
      <PriceLine
        label={t("admin.billing.price.output")}
        value={formatUsdPerMillion(entry.outputPriceUsdPerToken)}
      />
      <PriceLine
        label={t("admin.billing.price.cacheWrite")}
        value={formatUsdPerMillion(entry.cacheCreationPriceUsdPerToken)}
      />
      <PriceLine
        label={t("admin.billing.price.cacheRead")}
        value={formatUsdPerMillion(entry.cacheReadPriceUsdPerToken)}
      />
    </View>
  );
}

function PriceLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceLine}>
      <Text style={styles.priceLabel}>{label}</Text>
      <Text style={styles.priceValue}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  onChangeText,
}: {
  label?: string;
  hint?: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const inputStyle = useMemo(() => (isFocused ? styles.inputFocused : styles.input), [isFocused]);
  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  return (
    <View style={label || hint ? styles.field : styles.unlabeledField}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        placeholder={placeholder}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function formatCny(value: number): string {
  return `CNY ${value.toFixed(2)}`;
}

function buildPlanDrafts(plans: ControlPlanRecord[]): PlanSettingsDrafts {
  return {
    free: planToDraft(
      plans.find((plan) => plan.id === "free") ?? {
        id: "free",
        name: "Free",
        priceCny: 0,
        monthlyGrantCny: 3,
        workspaceBytesLimit: 200 * BYTES_PER_MB,
        singleUploadBytesLimit: 20 * BYTES_PER_MB,
        enabled: true,
      },
    ),
    pro: planToDraft(
      plans.find((plan) => plan.id === "pro") ?? {
        id: "pro",
        name: "Pro",
        priceCny: 39,
        monthlyGrantCny: 30,
        workspaceBytesLimit: 5 * 1024 * BYTES_PER_MB,
        singleUploadBytesLimit: 200 * BYTES_PER_MB,
        enabled: true,
      },
    ),
  };
}

function planToDraft(plan: ControlPlanRecord): PlanSettingsDraft {
  return {
    priceCny: String(plan.priceCny),
    monthlyGrantCny: String(plan.monthlyGrantCny),
    workspaceMbLimit: bytesToMb(plan.workspaceBytesLimit),
    singleUploadMbLimit: bytesToMb(plan.singleUploadBytesLimit),
    enabled: plan.enabled,
  };
}

function bytesToMb(value: number): string {
  return String(Math.round((value / BYTES_PER_MB) * 100) / 100);
}

function mbToBytes(value: string): number {
  return Math.round(Number(value) * BYTES_PER_MB);
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatShortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 14) {
    return trimmed;
  }
  const prefix = trimmed.includes("_") ? `${trimmed.split("_")[0]}_` : "";
  return `${prefix}...${trimmed.slice(-8)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function formatUsdPerMillion(value: number): string {
  return `$${(value * 1_000_000).toFixed(2)} / 1M tokens`;
}

function billingAccountStatusVariant(status: ControlBillingStatus): "success" | "error" | "muted" {
  if (status === "active" || status === "free") {
    return "success";
  }
  if (status === "past_due") {
    return "muted";
  }
  return "error";
}

function referralStatusVariant(status: ControlReferralStatus): "success" | "error" | "muted" {
  if (status === "rewarded") {
    return "success";
  }
  if (status === "rejected") {
    return "error";
  }
  return "muted";
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${value} B`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: "#f5f5f7",
  },
  embeddedRoot: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#e6e7eb",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#fcfcfd",
    padding: theme.spacing[3],
    elevation: 4,
  },
  embeddedScroll: {
    flex: 1,
    minHeight: 0,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  statePanel: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[4],
  },
  content: {
    width: "100%",
    alignSelf: "center",
    flex: 1,
    minHeight: 0,
    flexGrow: 1,
    gap: theme.spacing[2],
  },
  sectionTitleText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  icon: {
    color: theme.colors.foreground,
  },
  accentIcon: {
    color: "#167a4a",
  },
  detailTabs: {
    alignSelf: "flex-start",
  },
  overviewTab: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
  },
  billingHero: {
    minHeight: 94,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderLeftWidth: 4,
    borderLeftColor: "#19a66a",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#f3faf6",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  billingHeroMain: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  billingHeroActions: {
    width: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  billingAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#dff6ea",
  },
  billingTitleBlock: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[1],
  },
  billingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  billingHeroValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  sparklineCard: {
    width: 92,
    height: 56,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#bfe9d1",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
    padding: theme.spacing[2],
  },
  sparklineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sparklineDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: "#19a66a",
  },
  sparklineDash: {
    width: 28,
    height: 4,
    borderRadius: 4,
    backgroundColor: "#dbe7ff",
  },
  sparklineBars: {
    height: 28,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
  },
  sparklineBarTiny: {
    width: 8,
    height: 10,
    borderRadius: 3,
    backgroundColor: "#b9e8ce",
  },
  sparklineBarSmall: {
    width: 8,
    height: 16,
    borderRadius: 3,
    backgroundColor: "#8bdcb0",
  },
  sparklineBarTall: {
    width: 8,
    height: 24,
    borderRadius: 3,
    backgroundColor: "#4fc37d",
  },
  sparklineBarMedium: {
    width: 8,
    height: 19,
    borderRadius: 3,
    backgroundColor: "#93b7ff",
  },
  sparklineBarPeak: {
    width: 8,
    height: 27,
    borderRadius: 3,
    backgroundColor: "#f5b84b",
  },
  topologyStrip: {
    flexDirection: "row",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#f3f5f8",
    padding: theme.spacing[2],
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e7ebf0",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  metricTileAccent: {
    width: 22,
    height: 3,
    marginBottom: theme.spacing[1],
    borderRadius: 3,
    backgroundColor: "#19a66a",
  },
  metricTileValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  metricTileLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  visualGrid: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  visualPanel: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#e6edf3",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
  },
  visualHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  visualTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  visualValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  resourceBars: {
    gap: theme.spacing[1],
  },
  resourceRow: {
    gap: theme.spacing[1],
  },
  resourceLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  resourceMeter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  resourceValue: {
    width: 132,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
  },
  usageTrack: {
    flex: 1,
    height: 5,
    overflow: "hidden",
    borderRadius: 7,
    backgroundColor: "#e8eaef",
  },
  overviewProgress: {
    gap: theme.spacing[2],
  },
  overviewProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  overviewProgressTrack: {
    height: 5,
    overflow: "hidden",
    borderRadius: 7,
    backgroundColor: "#e8eaef",
  },
  overviewProgressFill: {
    height: "100%",
    borderRadius: 7,
    backgroundColor: "#19a66a",
  },
  healthLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  healthValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  controlDock: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#e6edf3",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
  },
  controlDockGroup: {
    flex: 1,
    minWidth: 220,
    gap: theme.spacing[2],
  },
  controlDockTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  controlMetricRow: {
    gap: theme.spacing[1],
  },
  controlMetricValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  metric: {
    minWidth: 150,
    flexGrow: 1,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
  },
  metricLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  metricValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  stack: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
  },
  tabSplit: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  tabSidePanel: {
    width: 320,
    maxWidth: "100%",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[3],
  },
  tabMainPanel: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[3],
  },
  panelHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[3],
  },
  panelHeading: {
    minWidth: 0,
    gap: theme.spacing[1],
  },
  panelHeadingIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#e5f7ee",
  },
  sideActions: {
    gap: theme.spacing[2],
  },
  settingsPage: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
  },
  settingsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  settingsGroup: {
    minWidth: 320,
    flexBasis: "48%",
    flexGrow: 1,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#e4e8ee",
    borderRadius: 14,
    backgroundColor: "#ffffff",
    padding: theme.spacing[2],
  },
  settingsGroupWide: {
    minWidth: 320,
    flexBasis: "100%",
    flexGrow: 1,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#e4e8ee",
    borderRadius: 14,
    backgroundColor: "#ffffff",
    padding: theme.spacing[2],
  },
  settingsGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: "#edf0f3",
    paddingBottom: theme.spacing[2],
  },
  settingsGroupIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#effaf4",
  },
  settingsGroupCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  settingsGroupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  settingsGroupDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  settingsFieldGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  planSettingsGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  planSettingsCard: {
    minWidth: 300,
    flex: 1,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#e4e8ee",
    borderRadius: 12,
    backgroundColor: "#fbfcfd",
    padding: theme.spacing[2],
  },
  planSettingsCardPro: {
    minWidth: 300,
    flex: 1,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#bfeccd",
    borderRadius: 12,
    backgroundColor: "#f3fbf6",
    padding: theme.spacing[2],
  },
  planSettingsCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  planSettingsEyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  planSettingsName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  settingsField: {
    minWidth: 178,
    flex: 1,
    gap: 2,
    borderWidth: 1,
    borderColor: "#eef1f4",
    borderRadius: 10,
    backgroundColor: "#fbfcfd",
    padding: theme.spacing[2],
  },
  settingsFieldTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  settingsFieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  settingsFieldSuffix: {
    color: "#1f7a4d",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  settingsInput: {
    height: 34,
    borderWidth: 1,
    borderColor: "#dde3ea",
    borderRadius: 9,
    backgroundColor: "#ffffff",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
  },
  settingsInputFocused: {
    height: 34,
    borderWidth: 1,
    borderColor: "#19a66a",
    borderRadius: 9,
    backgroundColor: "#f7fdf9",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
  },
  settingsFieldHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
  },
  tabPanel: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: "#dfe8ef",
    borderLeftColor: "#19a66a",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#f9fcfa",
    padding: theme.spacing[3],
  },
  tabPanelHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  inlineFormGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  settingsPanel: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: "#dfe8ef",
    borderLeftColor: "#6b8cff",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fbfcff",
    padding: theme.spacing[3],
  },
  settingsActions: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    borderWidth: 1,
    borderColor: "#e4e8ee",
    borderRadius: 14,
    backgroundColor: "#ffffff",
    padding: theme.spacing[2],
  },
  toolbarPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
  },
  formGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  input: {
    width: "100%",
    minWidth: 180,
    height: 40,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
  },
  inputFocused: {
    width: "100%",
    minWidth: 180,
    height: 40,
    borderWidth: 1,
    borderColor: "#19a66a",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#f6fcf8",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
  },
  field: {
    minWidth: 220,
    flexGrow: 1,
    gap: theme.spacing[1],
  },
  unlabeledField: {
    minWidth: 180,
    flexGrow: 1,
  },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  fieldHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
  },
  rowCopy: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  table: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: "#dfe8ef",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  tableScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableScrollContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing[1],
  },
  tableAccentRail: {
    height: 4,
    flexDirection: "row",
  },
  tableAccentGreen: {
    flex: 2,
    backgroundColor: "#19a66a",
  },
  tableAccentBlue: {
    flex: 1,
    backgroundColor: "#6b8cff",
  },
  tableAccentGold: {
    flex: 1,
    backgroundColor: "#f5b84b",
  },
  tableHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: "#f3f5f8",
    paddingHorizontal: theme.spacing[3],
  },
  tableHeaderLeft: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  tableHeaderMiddle: {
    width: 280,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "right",
  },
  tableHeaderRight: {
    width: 260,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "right",
  },
  tableRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: "#eef1f4",
    backgroundColor: "#ffffff",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  tableLeft: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  tableMiddle: {
    width: 280,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    textAlign: "right",
  },
  tableMiddleStack: {
    width: 280,
    alignItems: "flex-end",
    gap: theme.spacing[1],
  },
  priceBreakdown: {
    width: 280,
    gap: theme.spacing[1],
  },
  priceLine: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  priceLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  priceValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
  },
  tableStrong: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  tableRightText: {
    width: 260,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
  },
  tableRightActions: {
    width: 260,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyState: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: "#eef1f4",
    backgroundColor: "#fbfcfd",
    padding: theme.spacing[4],
  },
  emptyIllustration: {
    width: 96,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dfe8ef",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
  },
  emptyCoinLarge: {
    position: "absolute",
    left: 22,
    top: 16,
    width: 22,
    height: 22,
    borderRadius: 22,
    backgroundColor: "#dff6ea",
    borderWidth: 1,
    borderColor: "#8bdcb0",
  },
  emptyCoinSmall: {
    position: "absolute",
    right: 24,
    top: 13,
    width: 14,
    height: 14,
    borderRadius: 14,
    backgroundColor: "#fff3d6",
    borderWidth: 1,
    borderColor: "#f5b84b",
  },
  emptyLine: {
    position: "absolute",
    bottom: 13,
    width: 48,
    height: 5,
    borderRadius: 5,
    backgroundColor: "#dbe7ff",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
