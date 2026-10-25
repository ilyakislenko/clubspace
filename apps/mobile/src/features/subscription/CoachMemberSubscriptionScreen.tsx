import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  assignSubscription,
  endSubscriptionFreeze,
  freezeSubscription,
  listMemberSubscriptions,
  listPlans,
  markSubscriptionPaid,
  type MemberSubscription,
  type MemberSubscriptions,
  type Plan,
} from "../../shared/api/member-subscriptions"
import { useAuth } from "../../shared/auth-context"
import { subscribeInvalidation } from "../../shared/cache/cache-events"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { SplitLayout } from "../../shared/components/SplitLayout"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { formatMoney, formatRuDay } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import {
  coachSubscriptionActions,
  parseWholeNumber,
  pastDebts,
} from "./coach-subscription-actions"
import {
  classesWord,
  freezeExtendsText,
  freezeLine,
  freezePhase,
  localYmd,
  paymentLine,
  periodText,
  toneColor,
} from "./subscription-state"

type Props = NativeStackScreenProps<RootStackParamList, "MemberSubscription">

type Mode = "pay" | "assign" | "freeze" | null

const MAX_AMOUNT = 10_000_000
const MAX_FREEZE_DAYS = 90
const DEFAULT_FREEZE_DAYS = 7

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "активен",
  CANCELLED: "отменён",
  EXPIRED: "истёк",
  SUSPENDED: "приостановлен",
}

const planLine = (p: Plan): string =>
  [
    `${p.durationDays} дн.`,
    p.classCount != null
      ? `${p.classCount} ${classesWord(p.classCount)}`
      : "безлимит",
    p.startsOnFirstVisit ? "с первой тренировки" : null,
    p.isFreeTrial ? "пробный, один раз" : null,
  ]
    .filter(Boolean)
    .join(" · ")

/**
 * A coach's view of one student's abonement: the current card, and — for a
 * student of the coach's own group (the server's `permissions.canManage`) —
 * mark the payment, sell a new abonement and freeze. Money writes go straight
 * to the server and are never queued offline: a payment that "succeeded" on a
 * phone with no network and then vanished would be worse than an error.
 */
export function CoachMemberSubscriptionScreen({ route }: Props) {
  const { userId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)

  const [data, setData] = useState<MemberSubscriptions | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)
  // 403: the caller may not read this student at all (not an error to retry).
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  // The abonement a payment is being marked on: the current one or a past debt.
  const [payFor, setPayFor] = useState<MemberSubscription | null>(null)
  const [busy, setBusy] = useState(false)

  const [payText, setPayText] = useState("")
  const [planId, setPlanId] = useState<string | null>(null)
  const [amountText, setAmountText] = useState("")
  const [paid, setPaid] = useState(true)
  const [daysText, setDaysText] = useState(String(DEFAULT_FREEZE_DAYS))
  const [reason, setReason] = useState("")

  const workspaceId = workspace?.workspaceId

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const subs = await listMemberSubscriptions({ workspaceId, userId })
      // Tariffs are only needed to sell, which only a manager may do.
      const tariffs = subs.permissions.canManage
        ? (await listPlans({ workspaceId })).data
        : []
      setData(subs)
      setPlans(tariffs)
      setError(null)
      setForbidden(false)
    } catch (e) {
      const status = (e as { response?: { status?: unknown } }).response?.status
      if (status === 403) setForbidden(true)
      setError(errorMessage(e, "Не удалось загрузить абонемент ученика"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!workspaceId) return
    return subscribeInvalidation(`subscription:${workspaceId}`, () => {
      void load()
    })
  }, [workspaceId, load])

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  // Per render, never memoized: the device day decides what is "open".
  const now = new Date()
  const today = localYmd(now)
  const actions = data ? coachSubscriptionActions(data, today) : null
  const current = data?.current ?? null
  const openFreeze = actions?.openFreeze ?? null
  const payment = current ? paymentLine(current) : null
  const freezeText = freezeLine(openFreeze, now)
  const frozenNow = openFreeze !== null && freezePhase(openFreeze, now) === "current"

  const debts = data ? pastDebts(data) : []
  const renewFromYmd = actions?.renewFromYmd ?? null

  const openPay = (target: MemberSubscription) => {
    setPayFor(target)
    setPayText(String(target.amountPaid))
    setMode("pay")
  }

  const openMode = (next: Exclude<Mode, null>) => {
    if (next === "assign") {
      setPlanId(null)
      setAmountText("")
      setPaid(true)
    }
    if (next === "freeze") {
      setDaysText(String(DEFAULT_FREEZE_DAYS))
      setReason("")
    }
    setMode(next)
  }

  const run = async (
    action: () => Promise<unknown>,
    done: string,
    failed: string,
  ) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      setMode(null)
      showToast(done, "success")
      await load()
    } catch (e) {
      showToast(errorMessage(e, failed), "error")
    } finally {
      setBusy(false)
    }
  }

  const payAmount = parseWholeNumber(payText, { min: 0, max: MAX_AMOUNT })
  const sellAmount = parseWholeNumber(amountText, { min: 0, max: MAX_AMOUNT })
  const freezeDays = parseWholeNumber(daysText, {
    min: 1,
    max: MAX_FREEZE_DAYS,
  })

  const submitPay = () => {
    if (!payFor || payAmount === null) return
    void run(
      () =>
        markSubscriptionPaid({
          workspaceId: workspace.workspaceId,
          userId,
          subscriptionId: payFor.id,
          data: { amount: payAmount },
        }),
      "Оплата отмечена",
      "Не удалось отметить оплату",
    )
  }

  const submitAssign = () => {
    if (!planId || sellAmount === null) return
    void run(
      () =>
        assignSubscription({
          workspaceId: workspace.workspaceId,
          userId,
          data: {
            planId,
            amountPaid: sellAmount,
            paid,
            // A renewal starts the day the current abonement ends.
            ...(renewFromYmd ? { startDate: renewFromYmd } : {}),
          },
        }),
      renewFromYmd ? "Абонемент продлён" : "Абонемент оформлен",
      renewFromYmd
        ? "Не удалось продлить абонемент"
        : "Не удалось оформить абонемент",
    )
  }

  const submitFreeze = () => {
    if (!current || freezeDays === null) return
    const note = reason.trim()
    void run(
      () =>
        freezeSubscription({
          workspaceId: workspace.workspaceId,
          userId,
          subscriptionId: current.id,
          data: { days: freezeDays, ...(note ? { reason: note } : {}) },
        }),
      "Абонемент заморожен",
      "Не удалось заморозить абонемент",
    )
  }

  const confirmEndFreeze = () => {
    if (!current || !openFreeze) return
    const freezeId = openFreeze.id
    showAlert(
      "Снять заморозку?",
      "Срок абонемента сократится на дни, которые вернутся в работу.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Снять",
          style: "destructive",
          onPress: () =>
            void run(
              () =>
                endSubscriptionFreeze({
                  workspaceId: workspace.workspaceId,
                  userId,
                  subscriptionId: current.id,
                  freezeId,
                }),
              "Заморозка снята",
              "Не удалось снять заморозку",
            ),
        },
      ],
    )
  }

  const currentCard = (
    <View style={styles.card}>
      {current ? (
        <>
          <Text style={styles.planName}>{current.planName}</Text>
          {current.classesRemaining != null && (
            <Text style={styles.classes}>
              Осталось занятий: {current.classesRemaining}
              {current.classesTotal != null ? ` из ${current.classesTotal}` : ""}
            </Text>
          )}
          <Text style={styles.meta}>
            Статус:{" "}
            {frozenNow ? "заморожен" : (STATUS_LABEL[current.status] ?? current.status)}
          </Text>
          <Text style={styles.meta}>Период: {periodText(current)}</Text>
          {openFreeze && freezeText && (
            <>
              <Text style={styles.freeze}>{freezeText}</Text>
              <Text style={styles.meta}>{freezeExtendsText(openFreeze.days)}</Text>
            </>
          )}
          {payment && (
            <Text
              style={[
                styles.meta,
                { color: toneColor(theme.colors, payment.tone) },
              ]}
            >
              {payment.text}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.meta}>Нет действующего абонемента</Text>
      )}
    </View>
  )

  const button = (
    label: string,
    onPress: () => void,
    variant: "primary" | "secondary" = "secondary",
    disabled = false,
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={[
        variant === "primary" ? styles.primary : styles.secondary,
        (disabled || busy) && styles.disabled,
      ]}
    >
      <Text
        style={variant === "primary" ? styles.primaryText : styles.secondaryText}
      >
        {label}
      </Text>
    </Pressable>
  )

  const closeButton = button("Отмена", () => setMode(null))

  const debtsCard =
    debts.length > 0 ? (
      <View style={styles.card}>
        <Text style={styles.planName}>Неоплаченные абонементы</Text>
        {debts.map((d) => (
          <View key={d.id} style={styles.debt}>
            <Text style={styles.meta}>
              {d.planName} · {periodText(d)} · {formatMoney(d.amountPaid, d.currency)}
            </Text>
            {data?.permissions.canManage &&
              button("Отметить оплату", () => openPay(d))}
          </View>
        ))}
      </View>
    ) : null

  const actionsPanel = !actions ? null : !data?.permissions.canManage ? (
    <Text style={styles.hint}>
      Этот ученик не из ваших групп — управлять его абонементом может тренер
      группы или администратор клуба.
    </Text>
  ) : (
    <View style={styles.panel}>
      {mode === null && (
        <View style={styles.row}>
          {actions.canMarkPaid &&
            current &&
            button("Отметить оплату", () => openPay(current), "primary")}
          {actions.canAssign &&
            button("Оформить абонемент", () => openMode("assign"))}
          {renewFromYmd && button("Продлить", () => openMode("assign"))}
          {actions.waitsForClasses && (
            <Text style={styles.hint}>
              Продлить можно, когда закончатся занятия
            </Text>
          )}
          {actions.canFreeze && button("Заморозить", () => openMode("freeze"))}
          {actions.canEndFreeze && button("Снять заморозку", confirmEndFreeze)}
        </View>
      )}

      {mode === "pay" && payFor && (
        <View style={styles.form}>
          <Text style={styles.label}>
            Получено, {payFor.currency === "RUB" ? "₽" : payFor.currency}
          </Text>
          <TextInput
            value={payText}
            onChangeText={setPayText}
            keyboardType="number-pad"
            placeholder="Сумма"
            placeholderTextColor={theme.colors.muted}
            accessibilityLabel="Полученная сумма"
            style={styles.input}
          />
          {payAmount === null && (
            <Text style={styles.invalid}>Введите сумму от 0 до 10 000 000</Text>
          )}
          <View style={styles.row}>
            {button(
              busy ? "Сохраняю…" : "Оплачено",
              submitPay,
              "primary",
              payAmount === null,
            )}
            {closeButton}
          </View>
        </View>
      )}

      {mode === "assign" && (
        <View style={styles.form}>
          {renewFromYmd && (
            <Text style={styles.hint}>
              Новый абонемент начнётся {formatRuDay(renewFromYmd)}, когда
              закончится текущий
            </Text>
          )}
          {plans.length === 0 ? (
            <Text style={styles.hint}>
              В клубе нет тарифов — попросите администратора создать тариф
            </Text>
          ) : (
            <ResponsiveGrid columns={{ medium: 2, expanded: 2 }}>
              {plans.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setPlanId(p.id)
                    setAmountText(String(p.price))
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: planId === p.id }}
                  style={[styles.plan, planId === p.id && styles.planOn]}
                >
                  <Text style={styles.planTitle}>{p.name}</Text>
                  <Text style={styles.planPrice}>
                    {formatMoney(p.price, p.currency)}
                  </Text>
                  <Text style={styles.caption}>{planLine(p)}</Text>
                </Pressable>
              ))}
            </ResponsiveGrid>
          )}
          {planId !== null && (
            <>
              <Text style={styles.label}>Сумма</Text>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="number-pad"
                placeholder="Сумма"
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel="Сумма абонемента"
                style={styles.input}
              />
              {sellAmount === null && (
                <Text style={styles.invalid}>
                  Введите сумму от 0 до 10 000 000
                </Text>
              )}
              <View style={styles.switchRow}>
                <Text style={styles.label}>Оплата получена</Text>
                <Switch
                  accessibilityLabel="Оплата получена"
                  value={paid}
                  onValueChange={setPaid}
                  trackColor={{
                    true: theme.colors.accent,
                    false: theme.colors.border,
                  }}
                />
              </View>
            </>
          )}
          <View style={styles.row}>
            {button(
              busy ? "Оформляю…" : "Оформить",
              submitAssign,
              "primary",
              planId === null || sellAmount === null,
            )}
            {closeButton}
          </View>
        </View>
      )}

      {mode === "freeze" && (
        <View style={styles.form}>
          <Text style={styles.label}>Дней заморозки (до {MAX_FREEZE_DAYS})</Text>
          <TextInput
            value={daysText}
            onChangeText={setDaysText}
            keyboardType="number-pad"
            accessibilityLabel="Дней заморозки"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
          />
          {freezeDays === null && (
            <Text style={styles.invalid}>
              Введите число от 1 до {MAX_FREEZE_DAYS}
            </Text>
          )}
          <Text style={styles.label}>Причина (видна ученику)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Например: травма, отпуск"
            placeholderTextColor={theme.colors.muted}
            maxLength={200}
            accessibilityLabel="Причина заморозки"
            style={styles.input}
          />
          <View style={styles.row}>
            {button(
              busy ? "Замораживаю…" : "Заморозить",
              submitFreeze,
              "primary",
              freezeDays === null,
            )}
            {closeButton}
          </View>
        </View>
      )}
    </View>
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accent}
              />
            }
          >
            {forbidden && !data ? (
              <Text style={styles.hint}>
                Этот ученик не из ваших групп — его абонемент вам недоступен.
              </Text>
            ) : (
              error && !data && <ErrorRetry message={error} onRetry={load} />
            )}

            {data?.memberName ? (
              <Text style={styles.name} numberOfLines={2}>
                {data.memberName}
              </Text>
            ) : null}

            {data && (
              <SplitLayout
                stackSideFirst
                side={
                  <View style={styles.sideStack}>
                    {currentCard}
                    {debtsCard}
                  </View>
                }
                main={actionsPanel}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    name: { ...theme.typography.bodyStrong, color: theme.colors.text },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 4,
    },
    planName: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    classes: {
      color: theme.colors.accent,
      fontSize: 15,
      fontWeight: "700",
      marginTop: 2,
    },
    meta: { color: theme.colors.muted, fontSize: 13 },
    freeze: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
    hint: {
      ...theme.typography.body,
      color: theme.colors.muted,
      fontSize: 13,
    },
    caption: { ...theme.typography.caption, color: theme.colors.muted },
    sideStack: { gap: theme.spacing(3) },
    debt: { gap: theme.spacing(2), marginTop: theme.spacing(2) },
    panel: { gap: theme.spacing(3) },
    form: { gap: theme.spacing(2) },
    row: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    label: { ...theme.typography.bodyStrong, color: theme.colors.text },
    invalid: { ...theme.typography.caption, color: theme.colors.danger },
    input: {
      color: theme.colors.text,
      fontSize: 15,
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    plan: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 2,
    },
    planOn: { borderColor: theme.colors.accent, borderWidth: 2 },
    planTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
    planPrice: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
    primary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: "600",
    },
    secondary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    secondaryText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    disabled: { opacity: 0.5 },
  })
