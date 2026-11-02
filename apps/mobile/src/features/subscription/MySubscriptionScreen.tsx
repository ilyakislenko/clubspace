import { useIsFocused } from "@react-navigation/native"
import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"

import {
  getMySubscription,
  type MyAbonement,
  type MySubscription,
  type Subscription,
} from "../../shared/api/subscriptions"
import { formatPhone } from "../../shared/format-ru"
import { dialPhone } from "../../shared/open-link"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import { OnlinePurchaseSection } from "../payments/OnlinePurchaseSection"
import { AbonementScopeChips, hasScoped } from "./AbonementScopeChips"
import { FreezeRequestSection } from "./FreezeRequestSection"
import {
  currentAbonements,
  freezeExtendsText,
  freezeLine,
  freezePhase,
  paymentLine,
  periodText,
  mySubscriptionState,
  toneColor,
} from "./subscription-state"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "активен",
  CANCELLED: "отменён",
  EXPIRED: "истёк",
  SUSPENDED: "приостановлен",
}

// Nothing on the server flips a subscription's status to EXPIRED when its end
// date passes — there is no expiry job, and the server decides "is this live?"
// by comparing the date. Rendering the raw status therefore labelled a pack
// that ran out yesterday as «активен», on the same screen that had just
// (correctly) stopped showing it as the current abonement.
const statusLabelFor = (s: { status: string; endDate: string | null }): string => {
  if (s.status === "ACTIVE" && s.endDate && new Date(s.endDate) <= new Date()) {
    return STATUS_LABEL.EXPIRED
  }
  return STATUS_LABEL[s.status] ?? s.status
}

export function MySubscriptionScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, actingAs } = useAuth()
  const scrollRef = useRef<ScrollViewInstance>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<MySubscription>(
    workspace ? `subscription:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        await getMySubscription({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  const focused = useIsFocused()
  // Pull-to-refresh re-reads the online purchase options too.
  const [paymentsReload, setPaymentsReload] = useState(0)
  const handleRefresh = () => {
    refetch()
    setPaymentsReload((n) => n + 1)
  }

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const banner = data ? mySubscriptionState(data) : null
  const abonements = data ? currentAbonements(data) : []
  // «Весь клуб» only contrasts a club-wide abonement with scoped neighbours.
  const showClubWide = abonements.length > 1 && hasScoped(abonements)
  // Per render, never memoized: the device day decides the phase.
  const frozenIds = new Set(
    abonements
      .filter((a) => a.freeze !== null && freezePhase(a.freeze) === "current")
      .map((a) => a.id),
  )
  // The freeze is asked for in the app now, so the hint stops sending the
  // member to the coach for it.
  const hasFreezeAsk = abonements.some(
    (a) => a.freezeRequest || a.freezeRequestWindow,
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      <KeyboardAvoidingContainer style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        {...keyboardScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && data ? <OfflineNotice /> : null}

        {banner && (
          <View style={styles.banner}>
            <Text style={[styles.bannerText, { color: toneColor(theme.colors, banner.tone) }]}>
              {banner.text}
            </Text>
          </View>
        )}

        {abonements.map((a) => (
          <View key={a.id} style={styles.abonement}>
            <AbonementCard
              abonement={a}
              frozenNow={frozenIds.has(a.id)}
              showClubWide={showClubWide}
            />
            <FreezeRequestSection
              workspaceId={workspace.workspaceId}
              subscriptionId={a.id}
              request={a.freezeRequest}
              window={a.freezeRequestWindow}
              onChanged={refetch}
            />
          </View>
        ))}

        {/* Paying for a child's abonement isn't offered yet. */}
        {!actingAs && (
          <OnlinePurchaseSection
            key={workspace.workspaceId}
            workspaceId={workspace.workspaceId}
            active={focused}
            reloadKey={paymentsReload}
            onPaid={refetch}
          />
        )}

        {data?.coach ? (
          <Text style={styles.meta}>
            Тренер группы: {data.coach.name}
            {data.coach.phone ? " · " : ""}
            {data.coach.phone ? (
              <Text
                style={styles.phoneLink}
                onPress={() => dialPhone(data.coach!.phone!)}
              >
                {formatPhone(data.coach.phone)}
              </Text>
            ) : null}
          </Text>
        ) : null}

        <Text style={styles.hint}>
          {hasFreezeAsk
            ? "По вопросам оплаты и продления обращайтесь к тренеру вашей группы или администратору клуба."
            : "По вопросам оплаты, продления и заморозки обращайтесь к тренеру вашей группы или администратору клуба."}
        </Text>

        {data && data.history.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>История</Text>
            <View style={styles.rows}>
              {data.history.map((s: Subscription) => (
                <View key={s.id} style={styles.row}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {s.planName}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {periodText(s)} ·{" "}
                    {frozenIds.has(s.id)
                      ? "заморожен"
                      : statusLabelFor(s)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

/** One current abonement: plan, scope, classes left, dates, freeze, payment. */
function AbonementCard({
  abonement: a,
  frozenNow,
  showClubWide,
}: {
  abonement: MyAbonement
  frozenNow: boolean
  showClubWide: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const freezeText = freezeLine(a.freeze)
  const payment = paymentLine(a)
  return (
    <View style={styles.card}>
      <Text style={styles.planName}>{a.planName}</Text>
      <AbonementScopeChips
        directions={a.directions ?? []}
        showClubWide={showClubWide}
      />
      {a.classesRemaining != null && (
        <Text style={styles.classes}>
          Осталось занятий: {a.classesRemaining}
          {a.classesTotal != null ? ` из ${a.classesTotal}` : ""}
        </Text>
      )}
      <Text style={styles.meta}>
        Статус: {frozenNow ? "заморожен" : statusLabelFor(a)}
      </Text>
      <Text style={styles.meta}>Период: {periodText(a)}</Text>
      {a.freeze && freezeText && (
        <>
          <Text style={styles.freeze}>{freezeText}</Text>
          <Text style={styles.meta}>{freezeExtendsText(a.freeze.days)}</Text>
        </>
      )}
      <Text
        style={[styles.meta, { color: toneColor(theme.colors, payment.tone) }]}
      >
        {payment.text}
      </Text>
      {a.isPaid === false && (
        <Text style={styles.meta}>
          Если вы уже оплатили — напомните тренеру отметить оплату
        </Text>
      )}
    </View>
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
    abonement: { gap: theme.spacing(3) },
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { fontSize: 15, fontWeight: "700" },
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
    phoneLink: { color: theme.colors.accent },
    hint: {
      ...theme.typography.body,
      color: theme.colors.muted,
      fontSize: 13,
    },
    sectionTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
      marginBottom: theme.spacing(1),
    },
    rows: { gap: theme.spacing(1) },
    row: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 2,
    },
    rowTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    rowMeta: { color: theme.colors.muted, fontSize: 12 },
  })
