import React, { useCallback } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { NavRowList } from "../../app/NavRowList"
import { NavTileGrid } from "../../app/NavTileGrid"
import { PROGRESS_SECTIONS, visibleSections } from "../../app/nav-sections"
import type { TabScreenProps } from "../../app/navigation"
import { getMyAchievements } from "../../shared/api/achievements"
import { getMyAttendance } from "../../shared/api/attendance"
import { getMyRanks } from "../../shared/api/ranks"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { Chevron } from "../../shared/components/Chevron"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { MONTHS_IN_RU, pluralRu } from "../../shared/format-ru"
import { supportsOfflineDownload } from "../../shared/platform"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { CurrentRankCard } from "../ranks/CurrentRankCard"
import { monthToDate } from "./progress-helpers"
import { WeeklyBars } from "./WeeklyBars"

export function ProgressScreen({ navigation }: TabScreenProps<"Progress">) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { sizeClass } = useResponsive()
  const workspaceId = workspace?.workspaceId
  const attendanceOn = isFeatureEnabled(workspace, "attendance")
  const ranksOn = isFeatureEnabled(workspace, "ranks")
  // Tabs stay mounted, so the month is read on every render (not memoized):
  // the key changes when the month does. Only `from` is sent; the server's
  // range then ends at "now", so today's check-in counts.
  const now = new Date()
  const { from } = monthToDate(now)
  const month = now.getMonth()

  const monthCount = useCachedResource(
    workspaceId && attendanceOn
      ? `attendance:${workspaceId}:month:${from}`
      : null,
    useCallback(
      async () =>
        (
          await getMyAttendance({
            workspaceId: workspaceId!,
            from,
            perPage: 1,
          })
        ).rangeCount,
      [workspaceId, from],
    ),
  )
  // Same key as the Achievements screen.
  const achievements = useCachedResource(
    workspaceId && attendanceOn ? `achievements:${workspaceId}` : null,
    useCallback(
      async () => await getMyAchievements({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Same key as MyRanksScreen.
  const ranks = useCachedResource(
    workspaceId && ranksOn ? `ranks:${workspaceId}` : null,
    useCallback(
      async () => await getMyRanks({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )

  const resources = [monthCount, achievements, ranks]
  const refreshing = resources.some((r) => r.refreshing)
  const stale = resources.some((r) => r.stale && r.data)

  // The attendance hero opens MyAttendance, so it gets no row of its own.
  const sections = visibleSections(
    PROGRESS_SECTIONS,
    (key) => isFeatureEnabled(workspace, key),
    supportsOfflineDownload,
  ).filter((s) => s.route !== "MyAttendance")

  if (!workspace) return null

  const count = monthCount.data
  const streak = achievements.data?.currentStreakWeeks ?? 0
  const total = achievements.data?.totalCheckIns ?? 0
  const next = achievements.data?.achievements.find(
    (a) =>
      a.metric === "checkins" &&
      a.threshold === achievements.data?.nextMilestone,
  )
  const remaining = next ? Math.max(0, next.threshold - total) : 0
  const milestonePct = next
    ? Math.min(100, Math.round((total / Math.max(1, next.threshold)) * 100))
    : 0
  const currentRanks = ranksOn ? (ranks.data?.current ?? []) : []

  return (
    <View style={styles.root}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => resources.forEach((r) => r.refetch())}
              tintColor={theme.colors.accent}
            />
          }
        >
          {stale && <OfflineNotice />}

          {attendanceOn && count != null && (
            <Pressable
              onPress={() => navigation.navigate("MyAttendance")}
              accessibilityRole="button"
              style={styles.hero}
            >
              <View style={styles.heroHead}>
                <Text style={styles.cardTitle}>Посещаемость</Text>
                <Chevron style={styles.chev} />
              </View>
              <View style={styles.heroCount}>
                <Text style={styles.heroNumber}>{count}</Text>
                <Text style={styles.heroUnit}>
                  {pluralRu(count, "тренировка", "тренировки", "тренировок")} в{" "}
                  {MONTHS_IN_RU[month]}
                </Text>
              </View>
              {/* A payload cached by an older build has no recentWeeks. */}
              {achievements.data?.recentWeeks && (
                <WeeklyBars counts={achievements.data.recentWeeks} />
              )}
              <Text style={streak > 0 ? styles.line : styles.muted}>
                {streak > 0
                  ? `🔥 ${streak} ${pluralRu(streak, "неделя", "недели", "недель")} подряд`
                  : "Тренируйтесь раз в неделю — начнётся серия"}
              </Text>
            </Pressable>
          )}

          <ResponsiveGrid columns={{ medium: 2, expanded: 2 }} fill>
            {attendanceOn && achievements.data && (
              <Pressable
                onPress={() => navigation.navigate("Achievements")}
                accessibilityRole="button"
                style={styles.card}
              >
                <Text style={styles.milestoneIcon}>
                  {next ? (next.icon ?? next.threshold) : "🏆"}
                </Text>
                <View style={styles.cardText}>
                  {next ? (
                    <>
                      <Text style={styles.cardTitle}>Следующая веха</Text>
                      <Text style={styles.strong}>{next.name}</Text>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${milestonePct}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.muted}>
                        ещё {remaining}{" "}
                        {pluralRu(remaining, "тренировка", "тренировки", "тренировок")}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.strong}>Все вехи открыты</Text>
                      <Text style={styles.muted}>Так держать!</Text>
                    </>
                  )}
                </View>
                <Chevron style={styles.chev} />
              </Pressable>
            )}

            {currentRanks.length > 0 && (
              <View style={styles.card}>
                <CurrentRankCard
                  ranks={currentRanks}
                  onPress={() => navigation.navigate("MyRanks")}
                  style={styles.rankCard}
                />
              </View>
            )}
          </ResponsiveGrid>

          {ranksOn && ranks.data && currentRanks.length === 0 && (
            <Text style={styles.noRank}>
              Ранг пока не присвоен — его назначает тренер.
            </Text>
          )}

          {sections.length > 0 && sizeClass !== "compact" && (
            <NavTileGrid
              sections={sections}
              onPress={(route) => navigation.navigate(route)}
              columns={{ medium: 3, expanded: 3 }}
            />
          )}

          {sections.length > 0 && sizeClass === "compact" && (
            <NavRowList
              sections={sections}
              onPress={(route) => navigation.navigate(route)}
            />
          )}
        </ScrollView>
      </CenteredColumn>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    card: {
      flexGrow: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    hero: {
      gap: theme.spacing(3),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    heroHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    heroCount: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing(2) },
    heroNumber: { fontSize: 48, fontWeight: "800", color: theme.colors.text },
    heroUnit: { ...theme.typography.body, color: theme.colors.text, flexShrink: 1 },
    cardText: { flex: 1, gap: 2 },
    cardTitle: { ...theme.typography.label },
    strong: { ...theme.typography.bodyStrong, color: theme.colors.text },
    line: { ...theme.typography.body, color: theme.colors.text },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    chev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
    milestoneIcon: { fontSize: 32 },
    progressTrack: {
      alignSelf: "stretch",
      height: 4,
      borderRadius: 3,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceMuted,
      marginVertical: theme.spacing(1),
    },
    progressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
    rankCard: { flex: 1 },
    noRank: {
      ...theme.typography.caption,
      color: theme.colors.muted,
      paddingHorizontal: theme.spacing(1),
    },
  })
