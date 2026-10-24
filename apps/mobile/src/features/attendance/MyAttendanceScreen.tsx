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

import {
  getMyAttendance,
  type AttendanceSession,
  type MyAttendance,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { MONTHS_IN_RU, MONTHS_RU, pluralRu } from "../../shared/format-ru"
import {
  addMonths,
  attendedDays,
  monthGrid,
  monthRange,
  monthToDate,
  yearMonth,
} from "../progress/progress-helpers"

const PER_PAGE = 100
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

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
  // these (merged + deduped at render); only a workspace switch drops them.
  // genRef drops a page that resolves after such a reset.
  const [more, setMore] = useState<AttendanceSession[]>([])
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [ym, setYm] = useState(() => yearMonth(new Date()))
  const currentYm = yearMonth(new Date())
  const isCurrent = ym === currentYm

  // The current month ends today, like the Progress hub's window.
  const range = isCurrent
    ? { from: monthRange(ym).from, to: monthToDate(new Date()).to }
    : monthRange(ym)

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<MyAttendance>(
    workspace ? `attendance:${workspace.workspaceId}:cal:${ym}` : null,
    useCallback(
      async () =>
        await getMyAttendance({
          workspaceId: workspace!.workspaceId,
          ...range,
          curPage: 1,
          perPage: PER_PAGE,
        }),
      [workspace, range.from, range.to],
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
  const sessions = data
    ? [...data.sessions, ...more.filter((s) => !firstIds.has(s.id))]
    : []
  const hasMore = data ? sessions.length < data.rangeCount : false

  const loadMore = async () => {
    if (!workspace || !data || !hasMore || loadingMore) return
    const gen = genRef.current
    setLoadingMore(true)
    try {
      const next = await getMyAttendance({
        workspaceId: workspace.workspaceId,
        ...range,
        curPage: page + 1,
        perPage: PER_PAGE,
      })
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
  const title = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`
  const attended = attendedDays(sessions, ym)
  const today = new Date().getDate()

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
              <Text style={styles.monthTitle}>{title}</Text>
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
            {data && (
              <>
                <Text style={styles.summary}>
                  {data.rangeCount > 0
                    ? `${data.rangeCount} ${pluralRu(data.rangeCount, "тренировка", "тренировки", "тренировок")} в ${monthIn}`
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
                          <View key={di} style={styles.cell}>
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
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
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
