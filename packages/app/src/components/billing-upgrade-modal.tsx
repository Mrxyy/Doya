import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { loadAccountBootstrapSession } from "@/account/account-api";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  createControlBillingPayment,
  getControlBillingSummary,
  type ControlPlanId,
  type ControlPlanRecord,
} from "@/control/control-api";
import { useToast } from "@/contexts/toast-context";
import { useI18n } from "@/i18n/i18n";
import {
  type BillingUpgradeReason,
  useBillingUpgradeModalStore,
} from "@/stores/billing-upgrade-modal-store";
import { Check, CreditCard, Sparkles } from "@/components/icons/lucide";

type BillingPeriod = "monthly" | "yearly";
type PaymentProvider = "alipay" | "wxpay";

const UPGRADE_SNAP_POINTS = ["82%"];
const MIN_PAYMENT_AMOUNT_CNY = 0.1;
const DEFAULT_FREE_PLAN: ControlPlanRecord = {
  id: "free",
  name: "Free",
  priceCny: 0,
  monthlyGrantCny: 3,
  workspaceBytesLimit: 200 * 1024 * 1024,
  singleUploadBytesLimit: 20 * 1024 * 1024,
  enabled: true,
};
const DEFAULT_PRO_PLAN: ControlPlanRecord = {
  id: "pro",
  name: "Pro",
  priceCny: 39,
  monthlyGrantCny: 30,
  workspaceBytesLimit: 5 * 1024 * 1024 * 1024,
  singleUploadBytesLimit: 200 * 1024 * 1024,
  enabled: true,
};

export function BillingUpgradeModalHost() {
  const { t } = useI18n();
  const toast = useToast();
  const reason = useBillingUpgradeModalStore((state) => state.reason);
  const close = useBillingUpgradeModalStore((state) => state.close);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [providerType, setProviderType] = useState<PaymentProvider>("alipay");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [plans, setPlans] = useState<ControlPlanRecord[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<ControlPlanId | null>(null);
  const visible = reason !== null;
  const freePlan = useMemo(
    () => plans.find((plan) => plan.id === "free") ?? DEFAULT_FREE_PLAN,
    [plans],
  );
  const proPlan = useMemo(
    () => plans.find((plan) => plan.id === "pro") ?? DEFAULT_PRO_PLAN,
    [plans],
  );
  const isProRenewal = reason === "balance" && currentPlanId === "pro";
  const header = useMemo(
    () => ({ title: t(isProRenewal ? "billing.upgrade.renew.title" : "billing.upgrade.title") }),
    [isProRenewal, t],
  );
  const freeFeatures = useMemo(
    () => [
      {
        label: t("billing.upgrade.compare.usage"),
        value: formatMonthlyCredit(
          freePlan.monthlyGrantCny,
          t("billing.upgrade.period.monthSuffix"),
        ),
      },
      {
        label: t("billing.upgrade.compare.storage"),
        value: formatBytesShort(freePlan.workspaceBytesLimit),
      },
      {
        label: t("billing.upgrade.compare.upload"),
        value: formatBytesShort(freePlan.singleUploadBytesLimit),
      },
    ],
    [freePlan, t],
  );
  const proFeatures = useMemo(
    () => [
      {
        label: t("billing.upgrade.compare.usage"),
        value: formatMonthlyCredit(
          proPlan.monthlyGrantCny,
          t("billing.upgrade.period.monthSuffix"),
        ),
      },
      {
        label: t("billing.upgrade.compare.storage"),
        value: formatBytesShort(proPlan.workspaceBytesLimit),
      },
      {
        label: t("billing.upgrade.compare.upload"),
        value: formatBytesShort(proPlan.singleUploadBytesLimit),
      },
      {
        label: t("billing.upgrade.compare.support"),
        value: t("billing.upgrade.pro.value.support"),
      },
    ],
    [proPlan, t],
  );
  const renewalFeatures = useMemo(
    () => [
      {
        label: t("billing.upgrade.compare.usage"),
        value: formatMonthlyCredit(
          proPlan.monthlyGrantCny,
          t("billing.upgrade.period.monthSuffix"),
        ),
      },
      {
        label: t("billing.upgrade.compare.storage"),
        value: formatBytesShort(proPlan.workspaceBytesLimit),
      },
      {
        label: t("billing.upgrade.compare.upload"),
        value: formatBytesShort(proPlan.singleUploadBytesLimit),
      },
      {
        label: t("billing.upgrade.compare.support"),
        value: t("billing.upgrade.pro.value.support"),
      },
    ],
    [proPlan, t],
  );
  const heroBody = useMemo(
    () =>
      billingUpgradeBody(t, reason, isProRenewal, {
        grant: formatCnyCompact(proPlan.monthlyGrantCny),
        storage: formatBytesShort(proPlan.workspaceBytesLimit),
        upload: formatBytesShort(proPlan.singleUploadBytesLimit),
      }),
    [isProRenewal, proPlan, reason, t],
  );
  const freePrice = useMemo(
    () =>
      formatPlanPrice(freePlan.priceCny, "monthly", {
        month: t("billing.upgrade.period.monthSuffix"),
        year: t("billing.upgrade.period.yearSuffix"),
        applyPaymentMinimum: false,
      }),
    [freePlan, t],
  );
  const proPrice = useMemo(
    () =>
      formatPlanPrice(proPlan.priceCny, period, {
        month: t("billing.upgrade.period.monthSuffix"),
        year: t("billing.upgrade.period.yearSuffix"),
        applyPaymentMinimum: true,
      }),
    [period, proPlan, t],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    let isMounted = true;
    setCurrentPlanId(null);
    async function loadPlans() {
      const accountSession = await loadAccountBootstrapSession();
      if (!accountSession) {
        return;
      }
      const summary = await getControlBillingSummary({ accountSession });
      if (isMounted) {
        setPlans(summary.plans);
        setCurrentPlanId(summary.plan.id);
      }
    }
    void loadPlans().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      isMounted = false;
    };
  }, [toast, visible]);

  const handleSelectAlipay = useCallback(() => {
    setProviderType("alipay");
  }, []);
  const handleSelectWxpay = useCallback(() => {
    setProviderType("wxpay");
  }, []);

  const handleSelectPro = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const accountSession = await loadAccountBootstrapSession();
      if (!accountSession) {
        throw new Error(t("session.error.loginRequired"));
      }
      const order = await createControlBillingPayment({
        accountSession,
        planId: "pro",
        billingPeriod: period,
        providerType,
      });
      const paymentTarget = order.urlscheme ?? order.paymentUrl ?? order.qrcode;
      if (!paymentTarget) {
        throw new Error(t("billing.payment.errorNoPaymentUrl"));
      }
      await Linking.openURL(paymentTarget);
      toast.show(t("billing.payment.opened"));
      close();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSubmitting(false);
    }
  }, [close, period, providerType, t, toast]);
  const handlePressSelectPro = useCallback(() => {
    void handleSelectPro();
  }, [handleSelectPro]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={close}
      header={header}
      desktopMaxWidth={720}
      snapPoints={UPGRADE_SNAP_POINTS}
    >
      <View style={styles.panel}>
        <View style={styles.topPanel}>
          <UpgradeHeroBackdrop />
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Sparkles size={18} color={styles.introIconColor.color} />
            </View>
            <View style={styles.introCopy}>
              <Text style={styles.reasonText}>
                {reason ? billingUpgradeReasonLabel(t, reason, isProRenewal) : ""}
              </Text>
              <Text style={styles.heroTitle}>
                {reason
                  ? billingUpgradeTitle(t, reason, isProRenewal)
                  : t("billing.upgrade.hero.account")}
              </Text>
              <Text style={styles.heroBody}>{heroBody}</Text>
            </View>
          </View>

          <View pointerEvents="none" style={styles.heroArt}>
            <View style={styles.heroArtCardBack} />
            <View style={styles.heroArtCardFront}>
              <Sparkles size={16} color={styles.heroArtIcon.color} />
              <View style={styles.heroArtLine} />
              <View style={styles.heroArtLineShort} />
            </View>
            <View style={styles.heroArtCoin}>
              <CreditCard size={16} color={styles.heroArtCoinIcon.color} />
            </View>
          </View>

          <View style={styles.billingSwitch}>
            <PeriodToggle
              value={period}
              onChange={setPeriod}
              monthlyLabel={t("billing.upgrade.period.monthly")}
              yearlyLabel={t("billing.upgrade.period.yearlyShort")}
              yearlyBadge={t("billing.upgrade.period.yearlySave")}
            />
          </View>
        </View>

        <View style={styles.planGrid}>
          {isProRenewal ? (
            <PlanCard
              title={t("billing.upgrade.pro.title")}
              badge={t("billing.upgrade.renew.currentPro")}
              price={proPrice}
              features={renewalFeatures}
              selected
            />
          ) : (
            <>
              <PlanCard
                title={t("billing.upgrade.free.title")}
                badge={t("billing.upgrade.current")}
                price={freePrice}
                features={freeFeatures}
              />
              <PlanCard
                title={t("billing.upgrade.pro.title")}
                badge={t("billing.upgrade.recommended")}
                price={proPrice}
                features={proFeatures}
                selected
              />
            </>
          )}
        </View>

        <View style={styles.paymentMethodRow}>
          <PaymentMethodOption
            label={t("billing.payment.alipay")}
            selected={providerType === "alipay"}
            onPress={handleSelectAlipay}
          />
          <PaymentMethodOption
            label={t("billing.payment.wxpay")}
            selected={providerType === "wxpay"}
            onPress={handleSelectWxpay}
          />
        </View>

        <Button
          variant="default"
          size="lg"
          onPress={handlePressSelectPro}
          leftIcon={Sparkles}
          disabled={isSubmitting}
        >
          {t(isProRenewal ? "billing.upgrade.renew.payCta" : "billing.upgrade.payCta", {
            price: proPrice,
          })}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

function PaymentMethodOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const optionStyle = useMemo(
    () => [styles.paymentMethodOption, selected && styles.paymentMethodOptionSelected],
    [selected],
  );
  const textStyle = useMemo(
    () => [styles.paymentMethodText, selected && styles.paymentMethodTextSelected],
    [selected],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={optionStyle}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function PlanCard({
  title,
  badge,
  price,
  features,
  selected = false,
}: {
  title: string;
  badge: string;
  price: string;
  features: Array<{ label: string; value: string }>;
  selected?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!selected) {
      return;
    }
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, selected]);

  const firstPulseStyle = useMemo(
    () => ({
      opacity: pulse.interpolate({
        inputRange: [0, 0.72, 1],
        outputRange: [0.28, 0.06, 0],
      }),
      transform: [
        {
          scale: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.72, 1.75],
          }),
        },
      ],
    }),
    [pulse],
  );
  const secondPulseStyle = useMemo(
    () => ({
      opacity: pulse.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0, 0.18, 0],
      }),
      transform: [
        {
          scale: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.55, 1.35],
          }),
        },
      ],
    }),
    [pulse],
  );
  const cardStyle = useMemo(
    () => [styles.planCard, selected && styles.planCardSelected],
    [selected],
  );
  const badgeStyle = useMemo(
    () => [styles.planBadge, selected && styles.planBadgeSelected],
    [selected],
  );
  const firstPulseCombinedStyle = useMemo(
    () => [styles.selectedPulse, firstPulseStyle],
    [firstPulseStyle],
  );
  const secondPulseCombinedStyle = useMemo(
    () => [styles.selectedPulse, secondPulseStyle],
    [secondPulseStyle],
  );

  return (
    <View style={cardStyle}>
      <PlanCardBackdrop selected={selected} />
      <View style={styles.planHeader}>
        <Text style={badgeStyle}>{badge}</Text>
        {selected ? (
          <View style={styles.selectedMark}>
            <Animated.View style={firstPulseCombinedStyle} />
            <Animated.View style={secondPulseCombinedStyle} />
            <Check size={14} color={styles.selectedMarkIcon.color} />
          </View>
        ) : null}
      </View>
      <Text style={styles.planTitle}>{title}</Text>
      <Text style={styles.planPrice}>{price}</Text>
      <View style={styles.featureList}>
        {features.map((feature) => (
          <View key={feature.label} style={styles.featureRow}>
            <Text style={styles.featureLabel} numberOfLines={1}>
              {feature.label}
            </Text>
            <Text style={styles.featureValue} numberOfLines={1}>
              {feature.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function UpgradeHeroBackdrop() {
  return (
    <View pointerEvents="none" style={styles.heroBackdrop}>
      <View style={styles.heroGlowPrimary} />
      <View style={styles.heroGlowSecondary} />
      <View style={styles.heroRing} />
      <View style={styles.heroDot} />
    </View>
  );
}

function PeriodToggle({
  value,
  onChange,
  monthlyLabel,
  yearlyLabel,
  yearlyBadge,
}: {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  yearlyBadge: string;
}) {
  const handleMonthlyPress = useCallback(() => {
    onChange("monthly");
  }, [onChange]);
  const handleYearlyPress = useCallback(() => {
    onChange("yearly");
  }, [onChange]);

  return (
    <View style={styles.periodToggle}>
      <PeriodOption
        label={monthlyLabel}
        selected={value === "monthly"}
        onPress={handleMonthlyPress}
      />
      <PeriodOption
        label={yearlyLabel}
        badge={yearlyBadge}
        selected={value === "yearly"}
        onPress={handleYearlyPress}
      />
    </View>
  );
}

function PeriodOption({
  label,
  badge,
  selected,
  onPress,
}: {
  label: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const optionStyle = useMemo(
    () => [styles.periodOption, selected && styles.periodOptionSelected],
    [selected],
  );
  const labelStyle = useMemo(
    () => [styles.periodLabel, selected && styles.periodLabelSelected],
    [selected],
  );
  const badgeStyle = useMemo(
    () => [styles.periodBadge, selected && styles.periodBadgeSelected],
    [selected],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={optionStyle}
    >
      <Text style={labelStyle}>{label}</Text>
      {badge ? <Text style={badgeStyle}>{badge}</Text> : null}
    </Pressable>
  );
}

function PlanCardBackdrop({ selected }: { selected: boolean }) {
  const glowStyle = useMemo(
    () => [styles.planGlow, selected && styles.planGlowSelected],
    [selected],
  );
  const largeOrbStyle = useMemo(
    () => [styles.planOrbLarge, selected && styles.planOrbLargeSelected],
    [selected],
  );
  const smallOrbStyle = useMemo(
    () => [styles.planOrbSmall, selected && styles.planOrbSmallSelected],
    [selected],
  );

  return (
    <View pointerEvents="none" style={styles.planBackdrop}>
      {selected ? (
        <>
          <View style={glowStyle} />
          <View style={largeOrbStyle} />
          <View style={smallOrbStyle} />
          <View style={styles.planArt}>
            <View style={styles.planArtCardBack} />
            <View style={styles.planArtCardFront}>
              <Sparkles size={14} color={styles.planArtIcon.color} />
              <View style={styles.planArtLine} />
              <View style={styles.planArtLineShort} />
            </View>
          </View>
        </>
      ) : null}
      {!selected ? (
        <>
          <View style={styles.planFreeGlow} />
          <View style={styles.planFreeOrbLarge} />
          <View style={styles.planFreeOrbSmall} />
          <View style={styles.planFreeArt}>
            <View style={styles.planFreeArtCardBack} />
            <View style={styles.planFreeArtCardFront}>
              <View style={styles.planFreeArtIcon}>
                <CreditCard size={13} color={styles.planFreeArtIconColor.color} />
              </View>
              <View style={styles.planFreeArtLine} />
              <View style={styles.planFreeArtLineShort} />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function billingUpgradeReasonLabel(
  t: ReturnType<typeof useI18n>["t"],
  reason: BillingUpgradeReason,
  isProRenewal: boolean,
): string {
  if (isProRenewal) {
    return t("billing.upgrade.renew.reason");
  }
  switch (reason) {
    case "balance":
      return t("billing.upgrade.reason.balance");
    case "storage":
      return t("billing.upgrade.reason.storage");
    default:
      return t("billing.upgrade.reason.account");
  }
}

function billingUpgradeTitle(
  t: ReturnType<typeof useI18n>["t"],
  reason: BillingUpgradeReason,
  isProRenewal: boolean,
): string {
  if (isProRenewal) {
    return t("billing.upgrade.renew.hero");
  }
  switch (reason) {
    case "balance":
      return t("billing.upgrade.hero.balance");
    case "storage":
      return t("billing.upgrade.hero.storage");
    default:
      return t("billing.upgrade.hero.account");
  }
}

function billingUpgradeBody(
  t: ReturnType<typeof useI18n>["t"],
  reason: BillingUpgradeReason | null,
  isProRenewal: boolean,
  plan: { grant: string; storage: string; upload: string },
): string {
  if (isProRenewal) {
    return t("billing.upgrade.renew.bodyDynamic", plan);
  }
  switch (reason) {
    case "balance":
      return t("billing.upgrade.body.balanceDynamic", plan);
    case "storage":
      return t("billing.upgrade.body.storageDynamic", plan);
    default:
      return t("billing.upgrade.body.accountDynamic", plan);
  }
}

function formatPlanPrice(
  priceCny: number,
  period: BillingPeriod,
  suffix: { month: string; year: string; applyPaymentMinimum: boolean },
): string {
  if (period === "yearly") {
    const yearlyPrice = priceCny * 10;
    return `${formatCnyCompact(displayPlanAmount(yearlyPrice, suffix.applyPaymentMinimum))} / ${suffix.year}`;
  }
  return `${formatCnyCompact(displayPlanAmount(priceCny, suffix.applyPaymentMinimum))} / ${suffix.month}`;
}

function displayPlanAmount(value: number, applyPaymentMinimum: boolean): number {
  if (!applyPaymentMinimum || value <= 0) {
    return value;
  }
  return Math.max(value, MIN_PAYMENT_AMOUNT_CNY);
}

function formatMonthlyCredit(value: number, monthSuffix: string): string {
  return `${formatCnyCompact(value)} / ${monthSuffix}`;
}

function formatCnyCompact(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `¥${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

function formatBytesShort(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    const gb = value / 1024 / 1024 / 1024;
    return `${Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    const mb = value / 1024 / 1024;
    return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  return `${value} B`;
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[2],
  },
  topPanel: {
    position: "relative",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.18)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "#F7FFF9",
    padding: theme.spacing[3],
  },
  heroBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -118,
    right: -82,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
  },
  heroGlowSecondary: {
    position: "absolute",
    left: 48,
    bottom: -118,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(20, 184, 166, 0.08)",
  },
  heroRing: {
    position: "absolute",
    top: 24,
    right: 166,
    width: 72,
    height: 72,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.22)",
    borderRadius: 36,
    backgroundColor: "rgba(255, 255, 255, 0.34)",
  },
  heroDot: {
    position: "absolute",
    top: 34,
    right: 142,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(245, 158, 11, 0.5)",
  },
  intro: {
    zIndex: 1,
    flex: 1,
    minWidth: 280,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  introIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.palette.green[100],
  },
  introIconColor: {
    color: theme.colors.accent,
  },
  introCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  reasonText: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.green[100],
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  heroTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  heroBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  billingSwitch: {
    zIndex: 2,
    width: 240,
    maxWidth: "100%",
  },
  heroArt: {
    zIndex: 1,
    width: 118,
    height: 82,
    marginLeft: "auto",
    marginRight: theme.spacing[1],
  },
  heroArtCardBack: {
    position: "absolute",
    top: 8,
    right: 0,
    width: 78,
    height: 48,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.2)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(255, 255, 255, 0.42)",
  },
  heroArtCardFront: {
    position: "absolute",
    left: 0,
    bottom: 8,
    width: 98,
    height: 60,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.24)",
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    padding: theme.spacing[3],
    shadowColor: "#16a34a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 1,
  },
  heroArtIcon: {
    color: "#F59E0B",
  },
  heroArtLine: {
    width: "78%",
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
  },
  heroArtLineShort: {
    width: "54%",
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  heroArtCoin: {
    position: "absolute",
    right: 12,
    bottom: 0,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#F59E0B",
  },
  heroArtCoinIcon: {
    color: theme.colors.accentForeground,
  },
  periodToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[1],
  },
  periodOption: {
    flex: 1,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.xl,
  },
  periodOptionSelected: {
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.28)",
    backgroundColor: "#EAFBF1",
  },
  periodLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  periodLabelSelected: {
    color: theme.colors.accent,
  },
  periodBadge: {
    overflow: "hidden",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.green[100],
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  periodBadgeSelected: {
    backgroundColor: "#D8F7E5",
    color: theme.colors.accent,
  },
  planGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  paymentMethodRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[1],
  },
  paymentMethodOption: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
  },
  paymentMethodOptionSelected: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.36)",
  },
  paymentMethodText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  paymentMethodTextSelected: {
    color: theme.colors.accent,
  },
  planCard: {
    flex: 1,
    minWidth: 240,
    minHeight: 238,
    gap: theme.spacing[2],
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
  },
  planCardSelected: {
    borderColor: "rgba(16, 185, 129, 0.55)",
    backgroundColor: "#ECFFF4",
  },
  planBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  planGlow: {
    position: "absolute",
    top: -84,
    right: -72,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(56, 189, 248, 0.08)",
  },
  planGlowSelected: {
    backgroundColor: "rgba(56, 189, 248, 0.16)",
  },
  planOrbLarge: {
    position: "absolute",
    right: 24,
    bottom: 30,
    width: 86,
    height: 86,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.18)",
    borderRadius: 43,
    backgroundColor: "rgba(239, 246, 255, 0.7)",
  },
  planOrbLargeSelected: {
    borderColor: "rgba(56, 189, 248, 0.24)",
    backgroundColor: "rgba(239, 246, 255, 0.62)",
  },
  planOrbSmall: {
    position: "absolute",
    right: 96,
    bottom: 58,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(253, 230, 138, 0.58)",
  },
  planOrbSmallSelected: {
    backgroundColor: "rgba(251, 191, 36, 0.42)",
  },
  planFreeGlow: {
    position: "absolute",
    top: -70,
    right: -64,
    width: 178,
    height: 178,
    borderRadius: 89,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  planFreeOrbLarge: {
    position: "absolute",
    right: 22,
    bottom: 34,
    width: 92,
    height: 92,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.16)",
    borderRadius: 46,
    backgroundColor: "rgba(248, 250, 252, 0.82)",
  },
  planFreeOrbSmall: {
    position: "absolute",
    right: 102,
    bottom: 70,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(203, 213, 225, 0.42)",
  },
  planFreeArt: {
    position: "absolute",
    right: 16,
    top: 52,
    width: 100,
    height: 72,
  },
  planFreeArtCardBack: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 66,
    height: 42,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(248, 250, 252, 0.58)",
  },
  planFreeArtCardFront: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 82,
    height: 52,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.74)",
    padding: theme.spacing[2],
  },
  planFreeArtIcon: {
    width: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "rgba(241, 245, 249, 0.92)",
  },
  planFreeArtIconColor: {
    color: theme.colors.foregroundMuted,
  },
  planFreeArtLine: {
    width: "76%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
  },
  planFreeArtLineShort: {
    width: "52%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(203, 213, 225, 0.34)",
  },
  planArt: {
    position: "absolute",
    right: 14,
    top: 50,
    width: 100,
    height: 72,
  },
  planArtCardBack: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 66,
    height: 42,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.22)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.38)",
  },
  planArtCardFront: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 82,
    height: 52,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.28)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    padding: theme.spacing[2],
  },
  planArtIcon: {
    color: "#F59E0B",
  },
  planArtLine: {
    width: "76%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(56, 189, 248, 0.18)",
  },
  planArtLineShort: {
    width: "52%",
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
  },
  planHeader: {
    zIndex: 1,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  planBadge: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.full,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  planBadgeSelected: {
    borderColor: theme.colors.palette.green[200],
    color: theme.colors.accent,
    backgroundColor: theme.colors.surface0,
  },
  planTitle: {
    zIndex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  planPrice: {
    zIndex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  selectedMark: {
    position: "relative",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  selectedMarkIcon: {
    color: theme.colors.accentForeground,
  },
  selectedPulse: {
    position: "absolute",
    top: -9,
    left: -9,
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: "#38BDF8",
    borderRadius: 23,
    backgroundColor: "rgba(56, 189, 248, 0.14)",
  },
  featureList: {
    zIndex: 1,
    gap: theme.spacing[1],
  },
  featureRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
  },
  featureLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  featureValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
}));
