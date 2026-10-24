import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
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
import { Pressable } from "../../shared/components/Pressable"

import type { AttendanceSession, MyAttendance } from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  MONTHS_IN_RU,
  MONTHS_OF_RU,
  MONTHS_RU,
  pluralRu,
} from "../../shared/format-ru"
import {
  addMonths,
  attendedDays,
  inMonth,
  monthGrid,
  yearMonth,
} from "../progress/progress-helpers"
import { DAY_SHORT } from "../schedule/schedule-helpers"
import { fetchMonthAttendance, monthAttendanceKey } from "./month-attendance"

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => DAY_SHORT[d])
const trainings = (n: number) =>
  pluralRu(n, "тренировка", "тренировки", "тренировок")

const formatDate = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
  }).format(new Date(iso))

export function MyAttendanceScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  // Pages after the first. The cached resource owns page 1 (so offline and
  // realtime refreshes keep working). A background refresh of page 1 keeps
  // these (merged + deduped at render); a workspace or month switch drops
  // them. genRef drops a page that resolves after such a reset.
  const [more, setMore] = useState<AttendanceSession[]>([])
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [ym, setYm] = useState(() => yearMonth(new Date()))
  const isCurrent = ym === yearMonth(new Date())

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<MyAttendance>(
    workspace ? monthAttendanceKey(workspace.workspaceId, ym) : null,
    useCallback(
      async () => await fetchMonthAttendance(workspace!.workspaceId, ym),
      [workspace, ym],
    ),
  )

  const genRef = useRef(0)
  const workspaceId = workspace?.workspaceId
  useEffect(() => {
    genRef.current += 1
    setMore([])
    setPage(1)
    setLoadingMore(false)
  }, [workspaceId, ym])

  const firstIds = new Set(data?.sessions.map((s) => s.id))
  const loaded = data
    ? [...data.sessions, ...more.filter((s) => !firstIds.has(s.id))]
    : []
  const hasMore = data ? loaded.length < data.rangeCount : false
  // The window spills a day into each neighbouring month; keep this one's.
  const sessions = inMonth(loaded, ym)

  const loadMore = async () => {
    if (!workspace || !data || !hasMore || loadingMore) return
    const gen = genRef.current
    setLoadingMore(true)
    try {
      const next = await fetchMonthAttendance(
        workspace.workspaceId,
        ym,
        page + 1,
      )
      if (gen !== genRef.current) return
      setMore((prev) => {
        const seen = new Set([...data.sessions, ...prev].map((s) => s.id))
        return [...prev, ...next.sessions.filter((s) => !seen.has(s.id))]
      })
      setPage((p) => p + 1)
    } catch {
      // Keep what is on screen; the next scroll to the end retries.
    } finally {
      if (gen === genRef.current) setLoadingMore(false)
    }
  }

  if (!workspace) return null

  const [year, monthNo] = ym.split("-").map(Number)
  const monthName = MONTHS_RU[monthNo - 1]
  const monthIn = MONTHS_IN_RU[monthNo - 1]
  const monthOf = MONTHS_OF_RU[monthNo - 1]
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`
  const attended = attendedDays(sessions, ym)
  const today = new Date().getDate()

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={theme.colors.accent}
          />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.switcher}>
              <Pressable
                onPress={() => setYm((v) => addMonths(v, -1))}
                accessibilityRole="button"
                accessibilityLabel="Предыдущий месяц"
                style={styles.switchButton}
              >
                <Text style={styles.switchGlyph}>‹</Text>
              </Pressable>
              <Text
                style={styles.monthTitle}
                accessibilityRole="header"
                accessibilityLiveRegion="polite"
              >
                {title}
              </Text>
              <Pressable
                onPress={() => setYm((v) => addMonths(v, 1))}
                disabled={isCurrent}
                accessibilityRole="button"
                accessibilityLabel="Следующий месяц"
                accessibilityState={{ disabled: isCurrent }}
                style={[styles.switchButton, isCurrent && styles.switchOff]}
              >
                <Text style={styles.switchGlyph}>›</Text>
              </Pressable>
            </View>
            {loading && !data && (
              <ActivityIndicator
                color={theme.colors.accent}
                style={styles.footer}
              />
            )}
            {data && (
              <>
                <Text style={styles.summary}>
                  {sessions.length > 0
                    ? `${sessions.length} ${trainings(sessions.length)} в ${monthIn}`
                    : isCurrent
                      ? `В ${monthIn} пока нет тренировок`
                      : `В ${monthIn} тренировок нет`}
                </Text>
                <Text style={styles.subtitle}>
                  Всего за всё время: {data.total}
                </Text>
                <View style={styles.calendar}>
                  <View style={styles.weekRow}>
                    {WEEKDAYS.map((d) => (
                      <Text key={d} style={styles.weekday}>
                        {d}
                      </Text>
                    ))}
                  </View>
                  {monthGrid(ym).map((week, wi) => (
                    <View key={wi} style={styles.weekRow}>
                      {week.map((day, di) => {
                        if (day === null) return <View key={di} style={styles.cell} />
                        const n = attended.get(day) ?? 0
                        const future = isCurrent && day > today
                        const isToday = isCurrent && day === today
                        return (
                          <View
                            key={di}
                            style={styles.cell}
                            accessible
                            accessibilityLabel={
                              n > 0
                                ? `${day} ${monthOf}: ${n} ${trainings(n)}`
                                : `${day} ${monthOf}`
                            }
                          >
                            <View
                              style={[
                                styles.dayCircle,
                                n > 0 && styles.dayOn,
                                isToday && styles.dayToday,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.dayText,
                                  n > 0 && styles.dayTextOn,
                                  future && styles.dayFuture,
                                ]}
                              >
                                {day}
                              </Text>
                              {n > 1 && <View style={styles.multiDot} />}
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  ))}
                </View>
                {sessions.length > 0 && (
                  <Text style={styles.sectionTitle}>Тренировки</Text>
                )}
              </>
            )}
            {error && !data && <ErrorRetry message={error} onRetry={refetch} />}

            {stale && data ? <OfflineNotice /> : null}
          </View>
        }
        renderItem={({ item: s }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{s.title}</Text>
            <Text style={styles.rowDate}>{formatDate(s.startAt, s.timezone)}</Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              color={theme.colors.accent}
              style={styles.footer}
            />
          ) : null
        }
      />
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5) },
    header: { gap: theme.spacing(1), marginBottom: theme.spacing(3) },
    subtitle: { ...theme.typography.body, color: theme.colors.muted },
    switcher: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    switchButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    switchOff: { opacity: 0.3 },
    switchGlyph: { fontSize: 28, color: theme.colors.text, lineHeight: 32 },
    monthTitle: { ...theme.typography.subheading, color: theme.colors.text },
    summary: { ...theme.typography.bodyStrong, color: theme.colors.text },
    calendar: {
      alignSelf: "center",
      width: "100%",
      maxWidth: 420,
      gap: theme.spacing(1),
      marginTop: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    weekRow: { flexDirection: "row" },
    weekday: {
      flex: 1,
      textAlign: "center",
      ...theme.typography.caption,
      color: theme.colors.muted,
    },
    cell: {
      flex: 1,
      aspectRatio: 1,
      maxHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    dayCircle: {
      width: "86%",
      maxWidth: 40,
      maxHeight: 40,
      aspectRatio: 1,
      borderRadius: theme.radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    dayOn: { backgroundColor: theme.colors.accent },
    dayToday: { borderWidth: 1.5, borderColor: theme.colors.accent },
    dayText: { ...theme.typography.caption, color: theme.colors.text },
    dayTextOn: { color: theme.colors.accentText, fontWeight: "700" },
    dayFuture: { color: theme.colors.mutedFaint },
    multiDot: {
      position: "absolute",
      bottom: 3,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.accentText,
    },
    sectionTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
      marginTop: theme.spacing(3),
    },
    separator: { height: theme.spacing(1) },
    footer: { marginTop: theme.spacing(3) },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    rowDate: { color: theme.colors.muted, fontSize: 12 },
  })
