import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Animated, Easing, ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { BackHeader } from "@/components/headers/back-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { isWeb } from "@/constants/platform";
import {
  getControlBillingSummary,
  isControlApiConfigured,
  rescanControlBillingStorage,
  type ControlBillingSummary,
  type ControlBillingStatus,
  type ControlLedgerKind,
} from "@/control/control-api";
import { useToast } from "@/contexts/toast-context";
import { useI18n } from "@/i18n/i18n";
import { useBillingUpgradeModalStore } from "@/stores/billing-upgrade-modal-store";
import {
  Activity,
  Copy,
  CreditCard,
  Database,
  FileText,
  Gift,
  HardDrive,
  ReceiptText,
  RefreshCw,
  Sparkles,
  UploadCloud,
} from "@/components/icons/lucide";

interface UsageRollup {
  key: string;
  sessionId: string;
  providerModel: string;
  tokens: number;
  costCny: number;
}

type BillingTab = "storage" | "referral" | "usage" | "ledger";

export default function BillingScreen() {
  return <BillingPanel onBack={router.back} />;
}

export function BillingPanel({
  showHeader = true,
  onBack,
}: {
  showHeader?: boolean;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const openUpgrade = useBillingUpgradeModalStore((state) => state.open);
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [summary, setSummary] = useState<ControlBillingSummary | null>(null);
  const [activeTab, setActiveTab] = useState<BillingTab>("storage");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isControlApiConfigured()) {
      setError(t("billing.error.notConfigured"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const stored = await loadAccountBootstrapSession();
      if (!stored || !stored.workspace.workspaceId.startsWith("control:")) {
        throw new Error(t("session.error.loginRequired"));
      }
      setAccountSession(stored);
      setSummary(await getControlBillingSummary({ accountSession: stored }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const usageRollups = useMemo(() => {
    const totals = new Map<string, UsageRollup>();
    for (const log of summary?.recentUsageLogs ?? []) {
      const providerModel = `${log.providerId}/${log.modelId}`;
      const key = `${log.sessionId}:${providerModel}`;
      const current = totals.get(key) ?? {
        key,
        sessionId: log.sessionId,
        providerModel,
        tokens: 0,
        costCny: 0,
      };
      totals.set(key, {
        ...current,
        tokens:
          current.tokens +
          log.inputTokens +
          log.outputTokens +
          log.cacheCreationTokens +
          log.cacheReadTokens,
        costCny: current.costCny + log.actualCostCny,
      });
    }
    return [...totals.values()].sort((left, right) => right.costCny - left.costCny).slice(0, 8);
  }, [summary?.recentUsageLogs]);

  const inviteLink = summary ? buildInviteLink(summary.referralCode) : "";
  const storageRatio = summary
    ? divideForProgress(
        summary.storageQuota.workspaceBytesUsed,
        summary.storageQuota.workspaceBytesLimit,
      )
    : 0;
  const balanceRatio = summary
    ? divideForProgress(
        summary.balanceCny,
        Math.max(summary.plan.monthlyGrantCny, summary.balanceCny),
      )
    : 0;
  const isFreeBalanceExhausted = summary
    ? summary.plan.id === "free" && summary.balanceCny <= 0
    : false;
  const openBalanceUpgrade = useCallback(() => {
    openUpgrade("balance");
  }, [openUpgrade]);
  const tabs = useMemo<SegmentedControlOption<BillingTab>[]>(
    () => [
      {
        value: "storage",
        label: t("billing.storage.title"),
        icon: ({ color, size }) => <HardDrive size={size} color={color} />,
      },
      {
        value: "referral",
        label: t("billing.referral.title"),
        icon: ({ color, size }) => <Gift size={size} color={color} />,
      },
      {
        value: "usage",
        label: t("billing.usage.recent"),
        icon: ({ color, size }) => <Activity size={size} color={color} />,
      },
      {
        value: "ledger",
        label: t("billing.ledger.title"),
        icon: ({ color, size }) => <ReceiptText size={size} color={color} />,
      },
    ],
    [t],
  );

  const rescanStorage = useCallback(async () => {
    if (!accountSession) {
      return;
    }
    setIsMutating(true);
    try {
      await rescanControlBillingStorage({ accountSession });
      setSummary(await getControlBillingSummary({ accountSession }));
      toast.show(t("billing.toast.storageRefreshed"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMutating(false);
    }
  }, [accountSession, t, toast]);

  const copyInviteLink = useCallback(() => {
    if (!inviteLink) {
      return;
    }
    void Clipboard.setStringAsync(inviteLink).then(() =>
      toast.show(t("billing.toast.inviteCopied")),
    );
  }, [inviteLink, t, toast]);

  let body: ReactNode = null;
  let isScrollableBody = false;
  if (isLoading) {
    body = (
      <View style={styles.center}>
        <LoadingSpinner color={styles.spinnerColor.color} />
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t("billing.unavailable")}</Text>
        <Text style={styles.muted}>{error}</Text>
      </View>
    );
  } else if (summary) {
    isScrollableBody = true;
    body = (
      <View style={styles.content}>
        <BalanceHeroCard
          summary={summary}
          balanceRatio={balanceRatio}
          isFreeBalanceExhausted={isFreeBalanceExhausted}
          onUpgrade={openBalanceUpgrade}
        />

        <View style={styles.metricGrid}>
          <Metric
            icon={CreditCard}
            label={t("billing.metric.monthlyGrant")}
            value={formatCny(summary.plan.monthlyGrantCny)}
          />
          <Metric
            icon={Activity}
            label={t("billing.metric.monthUsage")}
            value={formatCny(summary.usage.actualCostCny)}
          />
          <Metric
            icon={ReceiptText}
            label={t("billing.metric.requests")}
            value={String(summary.usage.requestCount)}
          />
          <Metric
            icon={Database}
            label={t("billing.metric.tokens")}
            value={formatInteger(summary.usage.totalTokens)}
          />
        </View>

        <View style={styles.tabsPanel}>
          <SegmentedControl
            options={tabs}
            value={activeTab}
            onValueChange={setActiveTab}
            size="sm"
            style={styles.tabsControl}
            testID="billing-tabs"
          />
          <View style={styles.tabContent}>
            {activeTab === "storage" ? (
              <Section>
                <StorageTab
                  summary={summary}
                  storageRatio={storageRatio}
                  isMutating={isMutating}
                  onRescanStorage={rescanStorage}
                />
              </Section>
            ) : null}

            {activeTab === "referral" ? (
              <Section>
                <ReferralTab
                  summary={summary}
                  inviteLink={inviteLink}
                  onCopyInviteLink={copyInviteLink}
                />
              </Section>
            ) : null}

            {activeTab === "usage" ? (
              <Section scrollable>
                <UsageTab usageRollups={usageRollups} />
              </Section>
            ) : null}

            {activeTab === "ledger" ? (
              <Section scrollable>
                <LedgerTab summary={summary} />
              </Section>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {showHeader ? <BackHeader title={t("billing.title")} onBack={onBack ?? router.back} /> : null}
      {isScrollableBody ? (
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.contentScrollContent}
          showsVerticalScrollIndicator
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

function UpgradeTriggerCard({
  title,
  body,
  cta,
  onPress,
}: {
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const cardPulseLayerStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.heroUpgradeCardPulse, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.68, 1],
          outputRange: [0.24, 0.08, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.56, 1.62],
            }),
          },
        ],
      }),
    [pulse],
  );
  const cardPulseDelayLayerStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.heroUpgradeCardPulse, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.28, 0.86, 1],
          outputRange: [0, 0.18, 0.04, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.38, 1.26],
            }),
          },
        ],
      }),
    [pulse],
  );
  const widePulseLayerStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.heroUpgradeButtonPulse, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.72, 1],
          outputRange: [0.22, 0.05, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.76, 1.82],
            }),
          },
        ],
      }),
    [pulse],
  );
  const tightPulseLayerStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.heroUpgradeButtonPulse, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.18, 1],
          outputRange: [0, 0.18, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.6, 1.42],
            }),
          },
        ],
      }),
    [pulse],
  );

  return (
    <View style={styles.heroUpgrade}>
      <View pointerEvents="none" style={styles.heroUpgradeBackdrop}>
        <View style={styles.heroUpgradeGlow} />
        <Animated.View style={cardPulseLayerStyle} />
        <Animated.View style={cardPulseDelayLayerStyle} />
        <View style={styles.heroUpgradeRing} />
        <View style={styles.heroUpgradeDot} />
        <View style={styles.heroUpgradeBeam} />
        <View style={styles.heroUpgradeBeamSmall} />
        <View style={styles.heroUpgradePill} />
      </View>
      <View pointerEvents="none" style={styles.heroUpgradeArt}>
        <View style={styles.heroUpgradeArtBack} />
        <View style={styles.heroUpgradeArtFront}>
          <Sparkles size={14} color={styles.heroUpgradeArtIcon.color} />
          <View style={styles.heroUpgradeArtLine} />
          <View style={styles.heroUpgradeArtLineShort} />
        </View>
        <View style={styles.heroUpgradeCoin}>
          <CreditCard size={15} color={styles.heroUpgradeCoinIcon.color} />
        </View>
      </View>
      <View style={styles.heroUpgradeCopy}>
        <Text style={styles.heroUpgradeTitle}>{title}</Text>
        <Text style={styles.heroUpgradeBody}>{body}</Text>
      </View>
      <View style={styles.heroUpgradeButtonWrap}>
        <Animated.View style={widePulseLayerStyle} />
        <Animated.View style={tightPulseLayerStyle} />
        <Button variant="default" size="sm" onPress={onPress} leftIcon={Sparkles}>
          {cta}
        </Button>
      </View>
    </View>
  );
}

function BalanceHeroCard({
  summary,
  balanceRatio,
  isFreeBalanceExhausted,
  onUpgrade,
}: {
  summary: ControlBillingSummary;
  balanceRatio: number;
  isFreeBalanceExhausted: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useI18n();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 3200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const firstPulseStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.balanceHeroPulse, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.68, 1],
          outputRange: [0.28, 0.08, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.54, 1.82],
            }),
          },
        ],
      }),
    [pulse],
  );
  const secondPulseStyle = useMemo(
    () =>
      RNStyleSheet.compose(styles.balanceHeroPulseSmall, {
        opacity: pulse.interpolate({
          inputRange: [0, 0.22, 0.88, 1],
          outputRange: [0, 0.22, 0.06, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.44, 1.42],
            }),
          },
        ],
      }),
    [pulse],
  );

  return (
    <View style={styles.heroPanel}>
      <View pointerEvents="none" style={styles.balanceHeroBackdrop}>
        <View style={styles.balanceHeroGreenGlow} />
        <View style={styles.balanceHeroBlueGlow} />
        <View style={styles.balanceHeroPurplePane} />
        <View style={styles.balanceHeroAmberRing} />
        <View style={styles.balanceHeroMintDisk} />
        <View style={styles.balanceHeroBeam} />
        <View style={styles.balanceHeroBeamSmall} />
        <View style={styles.balanceHeroDotBlue} />
        <View style={styles.balanceHeroDotAmber} />
        <Animated.View style={firstPulseStyle} />
        <Animated.View style={secondPulseStyle} />
      </View>

      <View style={styles.heroCopy}>
        <View style={styles.heroHeader}>
          <View style={styles.planBadge}>
            <Sparkles size={14} color={styles.planBadgeIcon.color} />
            <Text style={styles.planBadgeText}>{summary.plan.name}</Text>
          </View>
          <BillingStatusMarker
            label={billingStatusLabel(t, summary.account.status)}
            tone={billingStatusTone(summary.account.status)}
          />
        </View>
        <Text style={styles.balance}>{formatCny(summary.balanceCny)}</Text>
        <Text style={styles.periodText}>
          {t("billing.period", {
            start: formatDate(summary.account.currentPeriodStart),
            end: formatDate(summary.account.currentPeriodEnd),
          })}
        </Text>
        <ProgressBar value={balanceRatio} />
      </View>

      <View style={styles.heroVisualColumn}>
        {isFreeBalanceExhausted ? (
          <UpgradeTriggerCard
            title={t("billing.upgradeTrigger.title")}
            body={t("billing.upgradeTrigger.body")}
            cta={t("billing.upgradeTrigger.cta")}
            onPress={onUpgrade}
          />
        ) : (
          <BillingIllustration />
        )}
      </View>
    </View>
  );
}

function BillingIllustration() {
  return (
    <View style={styles.illustration}>
      <View style={styles.illustrationGlowBlue} />
      <View style={styles.illustrationGlowAmber} />
      <View style={styles.illustrationRing} />
      <View style={styles.illustrationDot} />
      <View style={styles.illustrationCardBack}>
        <View style={styles.illustrationLineShort} />
        <View style={styles.illustrationLine} />
      </View>
      <View style={styles.illustrationCardFront}>
        <View style={styles.illustrationIcon}>
          <CreditCard size={20} color={styles.illustrationIconColor.color} />
        </View>
        <View style={styles.illustrationLine} />
        <View style={styles.illustrationLineShort} />
      </View>
    </View>
  );
}

function Section({ children, scrollable = false }: { children: ReactNode; scrollable?: boolean }) {
  return (
    <View style={styles.section}>
      <View style={styles.card}>
        {scrollable ? (
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardScrollContent}
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
        ) : (
          <View style={styles.cardStaticContent}>{children}</View>
        )}
      </View>
    </View>
  );
}

function StorageTab({
  summary,
  storageRatio,
  isMutating,
  onRescanStorage,
}: {
  summary: ControlBillingSummary;
  storageRatio: number;
  isMutating: boolean;
  onRescanStorage: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.storageLayout}>
      <View style={styles.storageMain}>
        <View style={styles.storageHeader}>
          <View style={styles.storageSummaryCopy}>
            <Text style={styles.featureEyebrow}>{t("billing.storage.title")}</Text>
            <Text style={styles.storageValue}>
              {formatBytes(summary.storageQuota.workspaceBytesUsed)}
              <Text style={styles.storageValueMuted}>
                {" / "}
                {formatBytes(summary.storageQuota.workspaceBytesLimit)}
              </Text>
            </Text>
            <Text style={styles.muted}>
              {t("billing.storage.parts", {
                uploaded: formatBytes(summary.storageQuota.uploadedBytesUsed),
                generated: formatBytes(summary.storageQuota.generatedBytesUsed),
              })}
            </Text>
          </View>
          <Button
            size="sm"
            variant="outline"
            leftIcon={RefreshCw}
            onPress={onRescanStorage}
            disabled={isMutating}
          >
            {t("billing.storage.refresh")}
          </Button>
        </View>
        <ProgressBar value={storageRatio} />
        <View style={styles.storageFooter}>
          <Text style={styles.storagePercent}>
            {Math.round(storageRatio * 100)}
            {"% "}
            {t("billing.storage.title")}
          </Text>
        </View>
      </View>
      <View style={styles.storageStatsPanel}>
        <StorageStat
          icon={UploadCloud}
          label={t("billing.storage.uploadedLabel")}
          value={formatBytes(summary.storageQuota.uploadedBytesUsed)}
        />
        <StorageStat
          icon={FileText}
          label={t("billing.storage.generatedLabel")}
          value={formatBytes(summary.storageQuota.generatedBytesUsed)}
        />
        <StorageStat
          icon={HardDrive}
          label={t("billing.storage.singleUploadLabel")}
          value={formatBytes(summary.storageQuota.singleUploadBytesLimit)}
        />
      </View>
    </View>
  );
}

function ReferralTab({
  summary,
  inviteLink,
  onCopyInviteLink,
}: {
  summary: ControlBillingSummary;
  inviteLink: string;
  onCopyInviteLink: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.referralLayout}>
      <View style={styles.inviteHero}>
        <View style={styles.inviteCodePanel}>
          <View style={styles.inviteIcon}>
            <Gift size={22} color={styles.inviteIconColor.color} />
          </View>
          <View style={styles.inviteCopy}>
            <Text style={styles.featureEyebrow}>{t("billing.referral.title")}</Text>
            <Text style={styles.inviteCode} numberOfLines={1}>
              {summary.referralCode}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {inviteLink}
            </Text>
          </View>
        </View>
        <Button size="sm" variant="outline" leftIcon={Copy} onPress={onCopyInviteLink}>
          {t("billing.referral.copy")}
        </Button>
      </View>
      <View style={styles.referralStatsGrid}>
        <StorageStat
          variant="grid"
          icon={Gift}
          label={t("billing.referral.registered")}
          value={String(summary.referralStats.registeredCount)}
        />
        <StorageStat
          variant="grid"
          icon={Activity}
          label={t("billing.referral.qualified")}
          value={String(summary.referralStats.qualifiedCount)}
        />
        <StorageStat
          variant="grid"
          icon={CreditCard}
          label={t("billing.referral.rewardTotal")}
          value={formatCny(summary.referralStats.rewardTotalCny)}
        />
      </View>
      <Text style={styles.referralRules}>{t("billing.referral.rules")}</Text>
    </View>
  );
}

function UsageTab({ usageRollups }: { usageRollups: UsageRollup[] }) {
  const { t } = useI18n();
  if (usageRollups.length === 0) {
    return <EmptyText label={t("billing.empty")} />;
  }

  return (
    <View style={styles.list}>
      {usageRollups.map((entry) => (
        <BillingListRow
          key={entry.key}
          title={formatProviderModel(entry.providerModel)}
          detail={t("billing.usage.sessionShort", {
            session: formatSessionId(entry.sessionId),
          })}
          middle={t("billing.usage.tokensShort", {
            tokens: formatInteger(entry.tokens),
          })}
          right={formatCny(entry.costCny)}
        />
      ))}
    </View>
  );
}

function LedgerTab({ summary }: { summary: ControlBillingSummary }) {
  const { t } = useI18n();
  const entries = summary.ledger.slice(0, 16);
  if (entries.length === 0) {
    return <EmptyText label={t("billing.empty")} />;
  }

  return (
    <View style={styles.list}>
      {entries.map((entry) => (
        <BillingListRow
          key={entry.id}
          title={ledgerKindLabel(t, entry.kind)}
          detail={entry.note ?? formatDate(entry.createdAt)}
          middle={formatDate(entry.createdAt)}
          right={formatCny(entry.amountCny)}
        />
      ))}
    </View>
  );
}

function StorageStat({
  icon: Icon,
  label,
  value,
  variant = "panel",
}: {
  icon: ComponentType<{ size: number; color: string }>;
  label: string;
  value: string;
  variant?: "panel" | "grid";
}) {
  const containerStyle = RNStyleSheet.compose(
    styles.storageStat,
    variant === "grid" ? styles.storageStatGrid : undefined,
  );

  return (
    <View style={containerStyle}>
      <View style={styles.storageStatIcon}>
        <Icon size={16} color={styles.storageStatIconColor.color} />
      </View>
      <View style={styles.storageStatCopy}>
        <Text style={styles.storageStatLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.storageStatValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}>
        <Icon size={16} color={styles.metricIconColor.color} />
      </View>
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  const fillStyle = useMemo(
    () => RNStyleSheet.compose(styles.progressFill, { width: `${Math.round(value * 100)}%` }),
    [value],
  );

  return (
    <View style={styles.progressTrack}>
      <View style={fillStyle} />
    </View>
  );
}

function BillingListRow({
  title,
  detail,
  middle,
  right,
}: {
  title: string;
  detail: string;
  middle: string;
  right: string;
}) {
  let amountToneStyle = undefined;
  if (right.includes("-")) {
    amountToneStyle = styles.listRightNegative;
  } else if (right !== "CNY 0.00") {
    amountToneStyle = styles.listRightPositive;
  }
  const amountStyle = RNStyleSheet.compose(styles.listRight, amountToneStyle);
  return (
    <View style={styles.listRow}>
      <View style={styles.listLeft}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={styles.listNumbers}>
        <Text style={styles.listMiddle} numberOfLines={1}>
          {middle}
        </Text>
        <Text style={amountStyle} numberOfLines={1}>
          {right}
        </Text>
      </View>
    </View>
  );
}

function EmptyText({ label }: { label: string }) {
  return <Text style={styles.empty}>{label}</Text>;
}

function BillingStatusMarker({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "error" | "muted";
}) {
  let dotToneStyle = undefined;
  let textToneStyle = undefined;
  if (tone === "success") {
    dotToneStyle = styles.statusDotSuccess;
    textToneStyle = styles.statusTextSuccess;
  } else if (tone === "error") {
    dotToneStyle = styles.statusDotError;
    textToneStyle = styles.statusTextError;
  }
  const dotStyle = RNStyleSheet.compose(styles.statusDot, dotToneStyle);
  const textStyle = RNStyleSheet.compose(styles.statusText, textToneStyle);

  return (
    <View style={styles.statusMarker}>
      <View style={dotStyle} />
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function formatCny(value: number): string {
  return `CNY ${value.toFixed(2)}`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatProviderModel(value: string): string {
  const [provider = "", model = ""] = value.split("/");
  return `${formatModelSegment(provider)} / ${formatModelSegment(model)}`.trim();
}

function formatModelSegment(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(?:\.\d+)?$/.test(part)) {
        return part;
      }
      return part.length <= 3
        ? part.toUpperCase()
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join("-");
}

function formatSessionId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 14) {
    return normalized;
  }
  const withoutPrefix = normalized.replace(/^ses[_-]?/i, "");
  const suffix = withoutPrefix.slice(-12);
  return suffix || normalized.slice(-12);
}

function divideForProgress(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / total));
}

function billingStatusLabel(
  t: ReturnType<typeof useI18n>["t"],
  status: ControlBillingStatus,
): string {
  switch (status) {
    case "active":
      return t("billing.status.active");
    case "usage_exhausted":
      return t("billing.status.usageExhausted");
    case "storage_exceeded":
      return t("billing.status.storageExceeded");
    case "past_due":
      return t("billing.status.pastDue");
    case "disabled":
      return t("billing.status.disabled");
    default:
      return t("billing.status.free");
  }
}

function billingStatusTone(status: ControlBillingStatus): "success" | "error" | "muted" {
  if (status === "active" || status === "free") {
    return "success";
  }
  if (status === "usage_exhausted" || status === "storage_exceeded" || status === "disabled") {
    return "error";
  }
  return "muted";
}

function ledgerKindLabel(t: ReturnType<typeof useI18n>["t"], kind: ControlLedgerKind): string {
  switch (kind) {
    case "top_up":
      return t("billing.ledger.kind.topUp");
    case "usage_charge":
      return t("billing.ledger.kind.usageCharge");
    case "referral_inviter_reward":
      return t("billing.ledger.kind.referralInviterReward");
    case "referral_invitee_bonus":
      return t("billing.ledger.kind.referralInviteeBonus");
    case "plan_quota_adjustment":
      return t("billing.ledger.kind.planQuotaAdjustment");
    case "admin_adjustment":
      return t("billing.ledger.kind.adminAdjustment");
    default:
      return t("billing.ledger.kind.monthlyGrant");
  }
}

function buildInviteLink(code: string): string {
  const encodedCode = encodeURIComponent(code);
  if (isWeb && typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}/?invite=${encodedCode}`;
  }
  return `doya://?invite=${encodedCode}`;
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "transparent",
  },
  contentScroll: {
    flex: 1,
    minHeight: 0,
  },
  contentScrollContent: {
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  content: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[12],
  },
  heroPanel: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[5],
    overflow: "hidden",
    minHeight: 138,
    borderWidth: 1,
    borderColor: "rgba(187, 247, 208, 0.7)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "#FBFFFC",
    padding: theme.spacing[3],
  },
  balanceHeroBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  balanceHeroGreenGlow: {
    position: "absolute",
    left: -72,
    top: -84,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(187, 247, 208, 0.34)",
  },
  balanceHeroBlueGlow: {
    position: "absolute",
    right: -54,
    top: -72,
    width: 230,
    height: 198,
    borderRadius: 115,
    backgroundColor: "rgba(191, 219, 254, 0.38)",
  },
  balanceHeroPurplePane: {
    position: "absolute",
    right: 168,
    top: 22,
    width: 62,
    height: 40,
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(216, 180, 254, 0.18)",
    transform: [{ rotate: "6deg" }],
  },
  balanceHeroAmberRing: {
    position: "absolute",
    right: 260,
    top: 42,
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.32)",
    borderRadius: 23,
    backgroundColor: "rgba(255, 251, 235, 0.26)",
  },
  balanceHeroMintDisk: {
    position: "absolute",
    left: 326,
    bottom: -72,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(153, 246, 228, 0.12)",
  },
  balanceHeroBeam: {
    position: "absolute",
    right: 92,
    bottom: 24,
    width: 126,
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
    transform: [{ rotate: "-7deg" }],
  },
  balanceHeroBeamSmall: {
    position: "absolute",
    right: 126,
    bottom: 14,
    width: 78,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    transform: [{ rotate: "-7deg" }],
  },
  balanceHeroDotBlue: {
    position: "absolute",
    right: 316,
    top: 30,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(59, 130, 246, 0.42)",
  },
  balanceHeroDotAmber: {
    position: "absolute",
    right: 210,
    bottom: 44,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(245, 158, 11, 0.38)",
  },
  balanceHeroPulse: {
    position: "absolute",
    right: 62,
    top: 32,
    width: 76,
    height: 76,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.38)",
    borderRadius: 38,
    backgroundColor: "rgba(14, 165, 233, 0.07)",
  },
  balanceHeroPulseSmall: {
    position: "absolute",
    right: 112,
    top: 48,
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.34)",
    borderRadius: 24,
    backgroundColor: "rgba(245, 158, 11, 0.06)",
  },
  heroCopy: {
    zIndex: 1,
    flex: 1,
    minWidth: 260,
    maxWidth: 380,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.74)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    padding: theme.spacing[3],
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  eyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.24)",
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
  },
  planBadgeIcon: {
    color: "#F59E0B",
  },
  planBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  balance: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  periodText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  statusMarker: {
    maxWidth: 132,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusDotSuccess: {
    backgroundColor: theme.colors.accent,
  },
  statusDotError: {
    backgroundColor: theme.colors.destructive,
  },
  statusText: {
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  statusTextSuccess: {
    color: theme.colors.accent,
  },
  statusTextError: {
    color: theme.colors.destructive,
  },
  illustration: {
    position: "relative",
    width: 152,
    height: 104,
    justifyContent: "center",
  },
  heroVisualColumn: {
    zIndex: 1,
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 174,
    paddingRight: theme.spacing[1],
  },
  illustrationGlowBlue: {
    position: "absolute",
    right: -16,
    top: -16,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(191, 219, 254, 0.44)",
  },
  illustrationGlowAmber: {
    position: "absolute",
    left: 18,
    bottom: -12,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(254, 240, 138, 0.38)",
  },
  illustrationRing: {
    position: "absolute",
    right: 18,
    bottom: 8,
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.24)",
    borderRadius: 21,
  },
  illustrationDot: {
    position: "absolute",
    left: 52,
    top: 18,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(245, 158, 11, 0.58)",
  },
  illustrationCardBack: {
    position: "absolute",
    top: 10,
    right: 2,
    width: 82,
    height: 50,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.18)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(255, 255, 255, 0.48)",
    padding: theme.spacing[3],
  },
  illustrationCardFront: {
    position: "absolute",
    left: 6,
    bottom: 12,
    width: 102,
    height: 62,
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.22)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(255, 255, 255, 0.86)",
    padding: theme.spacing[3],
  },
  illustrationIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(34, 197, 94, 0.1)",
  },
  illustrationIconColor: {
    color: theme.colors.accent,
  },
  illustrationLine: {
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(59, 130, 246, 0.18)",
  },
  illustrationLineShort: {
    width: "62%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.18)",
  },
  heroUpgrade: {
    position: "relative",
    width: 248,
    maxWidth: "100%",
    minHeight: 132,
    justifyContent: "space-between",
    gap: theme.spacing[2],
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.24)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "#ECFFF4",
    padding: theme.spacing[3],
  },
  heroUpgradeBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroUpgradeGlow: {
    position: "absolute",
    top: -86,
    right: -70,
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
  },
  heroUpgradeCardPulse: {
    position: "absolute",
    right: -34,
    bottom: -30,
    width: 138,
    height: 138,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.38)",
    borderRadius: 69,
    backgroundColor: "rgba(14, 165, 233, 0.1)",
  },
  heroUpgradeRing: {
    position: "absolute",
    right: 28,
    bottom: 46,
    width: 54,
    height: 54,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.24)",
    borderRadius: 27,
    backgroundColor: "rgba(255, 251, 235, 0.54)",
  },
  heroUpgradeDot: {
    position: "absolute",
    right: 96,
    top: 20,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(245, 158, 11, 0.5)",
  },
  heroUpgradeBeam: {
    position: "absolute",
    left: 18,
    bottom: 50,
    width: 104,
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
    transform: [{ rotate: "-8deg" }],
  },
  heroUpgradeBeamSmall: {
    position: "absolute",
    left: 34,
    bottom: 37,
    width: 64,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    transform: [{ rotate: "-8deg" }],
  },
  heroUpgradePill: {
    position: "absolute",
    right: 74,
    top: 78,
    width: 46,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(219, 234, 254, 0.68)",
  },
  heroUpgradeArt: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 92,
    height: 66,
    opacity: 0.9,
  },
  heroUpgradeArtBack: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 58,
    height: 38,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.22)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.42)",
  },
  heroUpgradeArtFront: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 76,
    height: 48,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.24)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    padding: theme.spacing[2],
  },
  heroUpgradeArtIcon: {
    color: "#F59E0B",
  },
  heroUpgradeArtLine: {
    width: "76%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
  },
  heroUpgradeArtLineShort: {
    width: "52%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  heroUpgradeCoin: {
    position: "absolute",
    right: 8,
    bottom: 0,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#F59E0B",
  },
  heroUpgradeCoinIcon: {
    color: theme.colors.accentForeground,
  },
  heroUpgradeCopy: {
    zIndex: 1,
    maxWidth: 142,
    gap: theme.spacing[1],
  },
  heroUpgradeTitle: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  heroUpgradeBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  heroUpgradeButtonWrap: {
    zIndex: 1,
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.borderRadius.xl,
  },
  heroUpgradeButtonPulse: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 96,
    height: 96,
    marginTop: -48,
    marginLeft: -48,
    borderWidth: 1,
    borderColor: theme.colors.accentForeground,
    borderRadius: 48,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  tabsPanel: {
    flex: 1,
    minHeight: 380,
    gap: theme.spacing[4],
    overflow: "hidden",
  },
  tabsControl: {
    alignSelf: "flex-start",
  },
  tabContent: {
    flex: 1,
    minHeight: 0,
  },
  section: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
  },
  card: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: "rgba(187, 247, 208, 0.72)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(240, 253, 244, 0.68)",
    overflow: "hidden",
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  cardStaticContent: {
    flex: 1,
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: "rgba(255, 255, 255, 0.36)",
  },
  storageLayout: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "stretch",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  storageMain: {
    flex: 1,
    minWidth: 320,
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
  storageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[4],
  },
  storageSummaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  storageValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["3xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  storageValueMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.normal,
  },
  storageStatsPanel: {
    width: 260,
    minWidth: 220,
    gap: theme.spacing[2],
  },
  storageStat: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
  },
  storageStatGrid: {
    flex: 1,
  },
  storageStatIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  storageStatIconColor: {
    color: theme.colors.accent,
  },
  storageStatCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  storageStatValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  storageStatLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  storageFooter: {
    alignItems: "flex-end",
  },
  storagePercent: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  featureEyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  referralLayout: {
    alignSelf: "stretch",
    gap: theme.spacing[3],
  },
  inviteHero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
  inviteCodePanel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  inviteIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
  },
  inviteIconColor: {
    color: theme.colors.accent,
  },
  inviteCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  inviteCode: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  referralStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  cardFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  referralRules: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  metric: {
    minWidth: 180,
    flex: 1,
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
  },
  metricIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  metricIconColor: {
    color: theme.colors.accent,
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  metricLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  metricValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  progressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  list: {
    gap: theme.spacing[2],
  },
  listRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.74)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    padding: theme.spacing[3],
  },
  listLeft: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  listNumbers: {
    minWidth: 96,
    alignItems: "flex-end",
    gap: 2,
  },
  listMiddle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  listRight: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  listRightNegative: {
    color: theme.colors.destructive,
  },
  listRightPositive: {
    color: theme.colors.accent,
  },
  input: {
    minHeight: 38,
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  errorTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
