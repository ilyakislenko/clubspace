import React, { useCallback } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

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

const DAY_MS = 24 * 60 * 60 * 1000

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "активен",
  CANCELLED: "отменён",
  EXPIRED: "истёк",
  SUSPENDED: "приостановлен",
}

type BannerState = {
  text: string
  tone: "ok" | "warn" | "danger" | "muted"
}

const bannerFor = (accessUntil: string | null, hasCurrent: boolean): BannerState => {
  if (!accessUntil) {
    return hasCurrent
      ? { text: "Доступ без ограничения по времени", tone: "ok" }
      : { text: "Абонемент не оформлен", tone: "muted" }
  }
  const until = new Date(accessUntil)
  const now = new Date()
  if (until < now) {
    return { text: `Доступ истёк ${fmtDate(accessUntil)}`, tone: "danger" }
  }
  const daysLeft = Math.ceil((until.getTime() - now.getTime()) / DAY_MS)
  return {
    text:
      daysLeft <= 14
        ? `Активен · до ${fmtDate(accessUntil)} (${daysLeft} дн.)`
        : `Активен · до ${fmtDate(accessUntil)}`,
    tone: daysLeft <= 14 ? "warn" : "ok",
  }
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

  const banner = data ? bannerFor(data.accessUntil, Boolean(data.current)) : null
  const bannerColor = (tone: BannerState["tone"]): string =>
    tone === "danger"
      ? theme.colors.danger
      : tone === "warn"
        ? theme.colors.accent
        : tone === "ok"
          ? theme.colors.text
          : theme.colors.muted

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
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
        <Text style={styles.title}>Мой абонемент</Text>

        {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && data ? <OfflineNotice /> : null}

        {banner && (
          <View style={styles.banner}>
            <Text style={[styles.bannerText, { color: bannerColor(banner.tone) }]}>
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
              Статус: {STATUS_LABEL[data.current.status] ?? data.current.status}
            </Text>
            <Text style={styles.meta}>
              Период: {fmtDate(data.current.startDate)}
              {data.current.endDate ? ` → ${fmtDate(data.current.endDate)}` : ""}
            </Text>
            <Text style={styles.meta}>
              Оплачено: {data.current.amountPaid} {data.current.currency}
            </Text>
          </View>
        )}

        <Text style={styles.hint}>
          Для оформления или продления абонемента обратитесь к администратору клуба.
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
                    {fmtDate(s.startDate)}
                    {s.endDate ? ` → ${fmtDate(s.endDate)}` : ""} ·{" "}
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
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
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
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
