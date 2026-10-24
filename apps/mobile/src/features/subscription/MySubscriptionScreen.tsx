import React, { useCallback } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"

import {
  getMySubscription,
  type MySubscription,
  type Subscription,
} from "../../shared/api/subscriptions"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatMoney } from "../../shared/format-ru"
import {
  freezeExtendsText,
  freezeLine,
  freezePhase,
  periodText,
  subscriptionState,
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
  const { workspace } = useAuth()

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

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const banner = data ? subscriptionState(data) : null
  // Per render, never memoized: the device day decides the phase.
  const freeze = data?.freeze ?? null
  const freezeText = freezeLine(freeze)
  const frozenNow = freeze !== null && freezePhase(freeze) === "current"

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
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

        {data?.current && (
          <View style={styles.card}>
            <Text style={styles.planName}>{data.current.planName}</Text>
            {data.current.classesRemaining != null && (
              <Text style={styles.classes}>
                Осталось занятий: {data.current.classesRemaining}
                {data.current.classesTotal != null
                  ? ` из ${data.current.classesTotal}`
                  : ""}
              </Text>
            )}
            <Text style={styles.meta}>
              Статус: {frozenNow ? "заморожен" : statusLabelFor(data.current)}
            </Text>
            <Text style={styles.meta}>
              Период: {periodText(data.current)}
            </Text>
            {freeze && freezeText && (
              <>
                <Text style={styles.freeze}>{freezeText}</Text>
                <Text style={styles.meta}>{freezeExtendsText(freeze.days)}</Text>
              </>
            )}
            <Text style={styles.meta}>
              Оплачено: {formatMoney(data.current.amountPaid, data.current.currency)}
            </Text>
          </View>
        )}

        <Text style={styles.hint}>
          Для оформления или продления абонемента обратитесь к тренеру или администратору клуба.
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
                    {frozenNow && s.id === data.current?.id
                      ? "заморожен"
                      : statusLabelFor(s)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
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
