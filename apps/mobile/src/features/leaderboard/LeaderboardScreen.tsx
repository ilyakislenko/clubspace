import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { CONTROL_MAX_WIDTH } from "../../shared/useResponsive"

import {
  getLeaderboard,
  setLeaderboardVisibility,
  type Leaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from "../../shared/api/leaderboard"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { pluralRu } from "../../shared/format-ru"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
]

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const streakLabel = (n: number): string =>
  `${n} ${pluralRu(n, "неделя", "недели", "недель")}`

export function LeaderboardScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()

  const [period, setPeriod] = useState<LeaderboardPeriod>("month")

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
    mutate,
  } = useCachedResource<Leaderboard>(
    workspace ? `leaderboard:${workspace.workspaceId}:${period}` : null,
    useCallback(
      async () =>
        await getLeaderboard({
          workspaceId: workspace!.workspaceId,
          period,
        }),
      [workspace, period],
    ),
  )

  const onToggleVisibility = useCallback(
    async (visible: boolean) => {
      if (!workspace || !data) return
      // Optimistic flip, reconcile with the server, revert on failure.
      mutate({ ...data, me: { ...data.me, hidden: !visible } })
      try {
        await setLeaderboardVisibility({
          workspaceId: workspace.workspaceId,
          hidden: !visible,
        })
      } catch (e) {
        showToast(errorMessage(e, "Не удалось изменить видимость."), "error")
      } finally {
        refetch()
      }
    },
    [workspace, data, mutate, refetch, showToast],
  )

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

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
        <Text style={styles.title}>Рейтинг посещаемости</Text>

        {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

        {stale && data ? <OfflineNotice /> : null}

        {data && !data.enabled && !error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Клуб отключил рейтинг посещаемости.
            </Text>
          </View>
        )}

        {data && data.enabled && (
          <>
            <View style={styles.periodRow}>
              {PERIODS.map((p) => {
                const active = period === p.key
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setPeriod(p.key)}
                    style={[styles.periodBtn, active && styles.periodBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Период: ${p.label}`}
                  >
                    <Text
                      style={[
                        styles.periodText,
                        active && styles.periodTextActive,
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.meCard}>
              <View style={styles.meStat}>
                <Text style={styles.meValue}>
                  {data.me.rank ? `#${data.me.rank}` : "—"}
                </Text>
                <Text style={styles.meLabel}>место</Text>
              </View>
              <View style={styles.meDivider} />
              <View style={styles.meStat}>
                <Text style={styles.meValue}>{data.me.checkins}</Text>
                <Text style={styles.meLabel}>тренировок</Text>
              </View>
              <View style={styles.meDivider} />
              <View style={styles.meStat}>
                <Text style={styles.meValue}>🔥 {data.me.streakWeeks}</Text>
                <Text style={styles.meLabel}>{streakLabel(data.me.streakWeeks)} подряд</Text>
              </View>
            </View>

            {data.entries.length === 0 ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  За этот период ещё никто не отмечался. Станьте первым в рейтинге!
                </Text>
              </View>
            ) : (
              <View style={styles.rows}>
                {data.entries.map((e: LeaderboardEntry) => (
                  <View
                    key={e.userId}
                    style={[styles.row, e.isMe && styles.rowMe]}
                  >
                    <Text style={styles.rank}>{MEDAL[e.rank] ?? e.rank}</Text>
                    <Text style={styles.name} numberOfLines={1}>
                      {e.name}
                      {e.isMe ? " (вы)" : ""}
                    </Text>
                    <Text style={styles.count}>{e.checkins}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.optOutRow}>
              <View style={styles.optOutText}>
                <Text style={styles.optOutLabel}>Показывать меня в рейтинге</Text>
                <Text style={styles.optOutHint}>
                  Выключите, чтобы другие не видели вас в таблице. Свою
                  статистику вы всё равно видите.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Показывать меня в рейтинге"
                value={!data.me.hidden}
                onValueChange={(v) => void onToggleVisibility(v)}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            </View>
          </>
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
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    periodRow: {
      flexDirection: "row",
      gap: theme.spacing(2),
      maxWidth: CONTROL_MAX_WIDTH,
    },
    periodBtn: {
      flex: 1,
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
    },
    periodBtnActive: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accent,
    },
    periodText: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
    periodTextActive: { color: theme.colors.accent },
    meCard: {
      flexDirection: "row",
      alignItems: "center",
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    meStat: { flex: 1, alignItems: "center", gap: 2 },
    meValue: { color: theme.colors.text, fontSize: 20, fontWeight: "800" },
    meLabel: { color: theme.colors.muted, fontSize: 11, textAlign: "center" },
    meDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: theme.colors.border,
    },
    rows: { gap: theme.spacing(1) },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowMe: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    rank: {
      minWidth: 28,
      textAlign: "center",
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "700",
    },
    name: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "500" },
    count: {
      color: theme.colors.muted,
      fontSize: 15,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    optOutRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(3),
      marginTop: theme.spacing(2),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    optOutText: { flex: 1, gap: 2 },
    optOutLabel: { color: theme.colors.text, fontSize: 15, fontWeight: "500" },
    optOutHint: { color: theme.colors.muted, fontSize: 12, lineHeight: 16 },
  })
