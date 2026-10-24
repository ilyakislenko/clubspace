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
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"

import {
  getMyAchievements,
  type Achievement,
  type Achievements,
} from "../../shared/api/achievements"
import { useAuth } from "../../shared/auth-context"
import { pluralRu } from "../../shared/format-ru"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

const weeksLabel = (n: number): string =>
  `${n} ${pluralRu(n, "неделя", "недели", "недель")}`

export function AchievementsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { sizeClass } = useResponsive()

  const { data, error, loading, refreshing, stale, refetch } =
    useCachedResource<Achievements>(
      workspace ? `achievements:${workspace.workspaceId}` : null,
      useCallback(
        async () =>
          await getMyAchievements({ workspaceId: workspace!.workspaceId }),
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

  const remainingToNext =
    data && data.nextMilestone !== null
      ? data.nextMilestone - data.totalCheckIns
      : null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
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

        {data && (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroNumber}>{data.totalCheckIns}</Text>
              <Text style={styles.heroLabel}>всего тренировок</Text>
              {remainingToNext !== null && remainingToNext > 0 && (
                <Text style={styles.heroNext}>
                  до отметки {data.nextMilestone} осталось {remainingToNext}
                </Text>
              )}
            </View>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {data.currentStreakWeeks}
                </Text>
                <Text style={styles.statLabel}>серия сейчас</Text>
                <Text style={styles.statSub}>
                  {weeksLabel(data.currentStreakWeeks)} подряд
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {data.longestStreakWeeks}
                </Text>
                <Text style={styles.statLabel}>лучшая серия</Text>
                <Text style={styles.statSub}>
                  {weeksLabel(data.longestStreakWeeks)}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Вехи</Text>
            <View
              style={[
                styles.badges,
                sizeClass !== "compact" && styles.badgesGrid,
              ]}
            >
              <ResponsiveGrid columns={{ medium: 3, expanded: 4 }}>
              {data.achievements.map((a: Achievement) => {
                const value =
                  a.metric === "streak"
                    ? data.longestStreakWeeks
                    : data.totalCheckIns
                const pct = Math.min(
                  100,
                  Math.round((value / Math.max(1, a.threshold)) * 100),
                )
                return (
                  <View
                    key={a.id}
                    style={[
                      styles.badge,
                      sizeClass !== "compact" && styles.badgeInGrid,
                      a.unlocked && styles.badgeOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeNumber,
                        !a.icon && a.unlocked && styles.badgeNumberOn,
                      ]}
                    >
                      {a.icon ?? a.threshold}
                    </Text>
                    <Text style={styles.badgeName} numberOfLines={2}>
                      {a.name}
                    </Text>
                    {a.unlocked && a.achievedAt ? (
                      <Text style={styles.badgeDate}>
                        {fmtDate(a.achievedAt)}
                      </Text>
                    ) : a.unlocked ? (
                      <Text style={styles.badgeDate}>открыто</Text>
                    ) : (
                      <View style={styles.progressWrap}>
                        <View style={styles.progressTrack}>
                          <View
                            style={[styles.progressFill, { width: `${pct}%` }]}
                          />
                        </View>
                        <Text style={styles.badgeLocked}>
                          {value}/{a.threshold}
                        </Text>
                      </View>
                    )}
                  </View>
                )
              })}
              </ResponsiveGrid>
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
    hero: {
      padding: theme.spacing(5),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accentSoft,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      gap: 4,
    },
    heroNumber: {
      fontSize: 48,
      fontWeight: "800",
      color: theme.colors.accent,
    },
    heroLabel: { ...theme.typography.label, color: theme.colors.muted },
    heroNext: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      marginTop: theme.spacing(1),
    },
    statRow: { flexDirection: "row", gap: theme.spacing(3) },
    statCard: {
      flex: 1,
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 2,
    },
    statValue: { fontSize: 28, fontWeight: "800", color: theme.colors.text },
    statLabel: { ...theme.typography.label, color: theme.colors.muted },
    statSub: { color: theme.colors.muted, fontSize: 12 },
    sectionTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
      marginTop: theme.spacing(1),
    },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing(3),
    },
    // Medium / expanded: the grid cell sizes the tile, not the 47% two-up rule.
    badgesGrid: { flexDirection: "column", flexWrap: "nowrap" },
    badgeInGrid: { width: "100%" },
    badge: {
      width: "47%",
      flexGrow: 1,
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      gap: 2,
      opacity: 0.6,
    },
    badgeOn: {
      backgroundColor: theme.colors.surfaceElevated,
      borderColor: theme.colors.accent,
      opacity: 1,
    },
    badgeNumber: {
      fontSize: 26,
      fontWeight: "800",
      color: theme.colors.muted,
    },
    badgeNumberOn: { color: theme.colors.accent },
    badgeName: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.text,
      textAlign: "center",
    },
    badgeDate: { color: theme.colors.textSecondary, fontSize: 12 },
    badgeLocked: { color: theme.colors.mutedFaint, fontSize: 12, marginTop: 3 },
    progressWrap: { alignSelf: "stretch", alignItems: "center", gap: 2 },
    progressTrack: {
      alignSelf: "stretch",
      height: 4,
      borderRadius: 3,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceMuted,
    },
    progressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
  })
