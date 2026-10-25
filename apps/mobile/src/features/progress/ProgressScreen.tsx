import React, { useCallback } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { NavRowList } from "../../app/NavRowList"
import { NavTileGrid } from "../../app/NavTileGrid"
import { PROGRESS_SECTIONS, visibleSections } from "../../app/nav-sections"
import type { TabScreenProps } from "../../app/navigation"
import { getMyAchievements } from "../../shared/api/achievements"
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
import {
  fetchMonthAttendance,
  monthAttendanceKey,
} from "../attendance/month-attendance"
import { CurrentRankCard } from "../ranks/CurrentRankCard"
import { inMonth, yearMonth } from "./progress-helpers"
import { WeeklyBars } from "./WeeklyBars"

export function ProgressScreen({ navigation }: TabScreenProps<"Progress">) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { sizeClass } = useResponsive()
  const workspaceId = workspace?.workspaceId
  const attendanceOn = isFeatureEnabled(workspace, "attendance")
  const ranksOn = isFeatureEnabled(workspace, "ranks")
  const achievementsOn = isFeatureEnabled(workspace, "achievements")
  // Tabs stay mounted, so the month is read on every render (not memoized):
  // the key changes when the month does. Same key and window as the
  // calendar on MyAttendance, so the two counts always agree.
  const now = new Date()
  const ym = yearMonth(now)
  const month = now.getMonth()

  const monthAttendance = useCachedResource(
    workspaceId && attendanceOn ? monthAttendanceKey(workspaceId, ym) : null,
    useCallback(
      async () => await fetchMonthAttendance(workspaceId!, ym),
      [workspaceId, ym],
    ),
  )
  // Same key as the Achievements screen. Fetched whenever attendance is on: the
  // weekly bars (recentWeeks) ride on this payload, which the server returns
  // with an empty achievements list when that section is off.
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

  const resources = [monthAttendance, achievements, ranks]
  const refreshing = resources.some((r) => r.refreshing)
  const stale = resources.some((r) => r.stale && r.data)

  // The attendance hero opens MyAttendance, so it gets no row of its own.
  const sections = visibleSections(
    PROGRESS_SECTIONS,
    (key) => isFeatureEnabled(workspace, key),
    supportsOfflineDownload,
  ).filter((s) => s.route !== "MyAttendance")

  if (!workspace) return null

  // null until the first load (or offline with no cache): the hero still
  // renders, so MyAttendance stays reachable.
  const count = monthAttendance.data
    ? inMonth(monthAttendance.data.sessions, ym).length
    : null
  const streak = achievements.data?.currentStreakWeeks ?? 0
  const badges = achievements.data?.achievements ?? []
  // The next check-in milestone, else any locked badge (a club may configure
  // streak badges only). "All open" only when nothing is locked.
  const next =
    badges.find(
      (a) =>
        a.metric === "checkins" &&
        a.threshold === achievements.data?.nextMilestone,
    ) ?? badges.find((a) => !a.unlocked)
  const nextValue =
    next?.metric === "streak"
      ? (achievements.data?.longestStreakWeeks ?? 0)
      : (achievements.data?.totalCheckIns ?? 0)
  const remaining = next ? Math.max(0, next.threshold - nextValue) : 0
  const milestonePct = next
    ? Math.min(100, Math.round((nextValue / Math.max(1, next.threshold)) * 100))
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

          {attendanceOn && (
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
                <Text style={styles.heroNumber}>{count ?? "—"}</Text>
                <Text style={styles.heroUnit}>
                  {pluralRu(count ?? 0, "тренировка", "тренировки", "тренировок")} в{" "}
                  {MONTHS_IN_RU[month]}
                </Text>
              </View>
              {/* A payload cached by an older build has no recentWeeks. */}
              {achievements.data?.recentWeeks && (
                <WeeklyBars counts={achievements.data.recentWeeks} />
              )}
              {achievementsOn && (
                <Text style={streak > 0 ? styles.line : styles.muted}>
                  {streak > 0
                    ? `🔥 ${streak} ${pluralRu(streak, "неделя", "недели", "недель")} подряд`
                    : "Тренируйтесь раз в неделю — начнётся серия"}
                </Text>
              )}
            </Pressable>
          )}

          <ResponsiveGrid columns={{ medium: 2, expanded: 2 }} fill>
            {attendanceOn && achievementsOn && badges.length > 0 && (
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
                        {next.metric === "streak"
                          ? `${pluralRu(remaining, "неделя", "недели", "недель")} серии`
                          : pluralRu(remaining, "тренировка", "тренировки", "тренировок")}
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
