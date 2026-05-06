import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  getWorkspaceSchedule,
  type ScheduleEvent,
  type ScheduleSession,
  type WorkspaceSchedule,
} from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "ClubSchedule">

const isoDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Returns a Date pointing to the start of the local-day for the given
// date. Used to bucket sessions by calendar day in workspace TZ. We
// take the date string from the session's startAt (in workspace TZ) so
// users in other zones don't shift sessions across days.
const formatTimeInTz = (
  iso: string,
  timeZone: string,
): { hourMinute: string; dateKey: string; dayLabel: string } => {
  // Intl.DateTimeFormat is the most reliable way to render a UTC instant
  // in an arbitrary IANA zone without pulling another dep.
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value
      return acc
    },
    {},
  )
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  const hourMinute = `${parts.hour}:${parts.minute}`
  // weekday returns the name in the locale we asked for ("понедельник");
  // we keep the lowercase form for the section header.
  const dayLabel = parts.weekday ?? ""
  return { hourMinute, dateKey, dayLabel }
}

type DayBucket = {
  dateKey: string
  dayLabel: string
  // Display date as DD.MM so the header doesn't overflow on Sunday.
  dateShort: string
  sessions: ScheduleSession[]
  events: ScheduleEvent[]
}

const buildDayBuckets = (
  schedule: WorkspaceSchedule,
  days: number = 14,
): DayBucket[] => {
  // Walk calendar days in the WORKSPACE timezone, not the device's. If a
  // Tomsk user (UTC+7) opens a Moscow workspace (UTC+3), iterating in
  // device-local time gives a date label that's the day BEFORE the
  // workspace-local date the same instant maps to. Sessions then land in
  // the right bucket key (which is built in workspace TZ from
  // session.startAt) but the bucket's label reads as the previous day,
  // so a Saturday slot shows up under "Пятница".
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: schedule.timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const buckets = new Map<string, DayBucket>()
  const baseTs = Date.now()
  for (let i = 0; i < days; i++) {
    // Stepping by 86 400 000 ms is fine across DST — the worst case
    // shifts the instant by 1h, never enough to skip a calendar day
    // given we anchor to the current moment.
    const parts = fmt
      .formatToParts(new Date(baseTs + i * 86_400_000))
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value
        return acc
      }, {})
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`
    if (buckets.has(dateKey)) continue
    buckets.set(dateKey, {
      dateKey,
      dayLabel: parts.weekday ?? "",
      dateShort: `${parts.day}.${parts.month}`,
      sessions: [],
      events: [],
    })
  }

  for (const session of schedule.sessions) {
    const { dateKey } = formatTimeInTz(session.startAt, schedule.timezone)
    buckets.get(dateKey)?.sessions.push(session)
  }
  for (const event of schedule.events) {
    const { dateKey } = formatTimeInTz(event.startAt, schedule.timezone)
    buckets.get(dateKey)?.events.push(event)
  }
  return [...buckets.values()]
}

export function ClubScheduleScreen({ navigation: _ }: Props) {
  // navigation prop is currently unused — the screen is a leaf view, but
  // we keep it typed so we can later add row taps that drill into
  // VideoScreen / a group detail.
  const { workspace } = useAuth()
  const [schedule, setSchedule] = useState<WorkspaceSchedule | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const range = useMemo(() => {
    // Pad the request by a day on each side so a TZ shift between the
    // device and the workspace can't slice off the edges of our 14-day
    // workspace-TZ window. Server is happy with a slightly wider range;
    // the client picks the right 14 buckets out of the response.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    start.setDate(start.getDate() - 1)
    const end = new Date(today)
    end.setDate(end.getDate() + 15)
    return { from: start, to: end }
  }, [])

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      const data = await getWorkspaceSchedule({
        workspaceId: workspace.workspaceId,
        from: isoDate(range.from),
        to: isoDate(range.to),
      })
      setSchedule(data)
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить расписание",
      )
    }
  }, [workspace, range])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  if (!workspace) {
    return null
  }

  if (schedule === null && !error) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const buckets = schedule
    ? buildDayBuckets(schedule, 14)
    : []

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View>
          <Text style={styles.title}>Расписание клуба</Text>
          <Text style={styles.subtitle}>
            На две недели вперёд. Время указано по часовому поясу клуба
            ({schedule?.timezone ?? "—"}).
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {buckets.map((bucket) => {
          const isEmpty =
            bucket.sessions.length === 0 && bucket.events.length === 0
          return (
            <View key={bucket.dateKey} style={styles.dayBlock}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{bucket.dayLabel}</Text>
                <Text style={styles.dayDate}>{bucket.dateShort}</Text>
              </View>
              {isEmpty ? (
                <Text style={styles.dayEmpty}>—</Text>
              ) : (
                <View style={styles.dayRows}>
                  {bucket.sessions.map((s) => (
                    <SessionRow
                      key={s.occurrenceId}
                      session={s}
                      timezone={schedule!.timezone}
                    />
                  ))}
                  {bucket.events.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      timezone={schedule!.timezone}
                    />
                  ))}
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

function SessionRow({
  session,
  timezone,
}: {
  session: ScheduleSession
  timezone: string
}) {
  const { hourMinute } = formatTimeInTz(session.startAt, timezone)
  const coachName =
    [session.group.coach.firstname, session.group.coach.lastname]
      .filter(Boolean)
      .join(" ")
      .trim() || session.group.coach.email
  return (
    <View
      style={[styles.row, session.cancelled && styles.rowCancelled]}
    >
      <Text
        style={[styles.rowTime, session.cancelled && styles.rowTimeCancelled]}
      >
        {hourMinute}
      </Text>
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowTitle,
            session.cancelled && styles.rowTitleCancelled,
          ]}
        >
          {session.group.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {session.group.gym
            ? `${session.group.gym.name} · ${session.group.gym.address}`
            : "Зал не указан"}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          Тренер: {coachName}
        </Text>
        {session.cancelled && (
          <Text style={styles.cancelLabel}>
            Отменено
            {session.cancellationReason
              ? ` — ${session.cancellationReason}`
              : ""}
          </Text>
        )}
      </View>
    </View>
  )
}

function EventRow({
  event,
  timezone,
}: {
  event: ScheduleEvent
  timezone: string
}) {
  const { hourMinute } = formatTimeInTz(event.startAt, timezone)
  return (
    <View style={[styles.row, styles.rowEvent]}>
      <Text style={styles.rowTime}>{hourMinute}</Text>
      <View style={styles.rowBody}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventBadge}>Ивент</Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {event.title}
          </Text>
        </View>
        {event.gym && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {event.gym.name} · {event.gym.address}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(3),
  },
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
    marginTop: theme.spacing(1),
  },
  error: { color: theme.colors.danger, fontSize: 13 },
  dayBlock: {
    gap: theme.spacing(1),
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: theme.spacing(1),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dayLabel: {
    ...theme.typography.bodyStrong,
    color: theme.colors.text,
    textTransform: "capitalize",
  },
  dayDate: {
    color: theme.colors.muted,
    fontSize: 12,
    fontFamily: undefined,
  },
  dayEmpty: {
    color: theme.colors.muted,
    fontSize: 13,
    paddingTop: theme.spacing(1),
  },
  dayRows: { gap: theme.spacing(1), paddingTop: theme.spacing(1) },
  row: {
    flexDirection: "row",
    gap: theme.spacing(3),
    padding: theme.spacing(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowEvent: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accent,
  },
  rowCancelled: {
    backgroundColor: theme.colors.surface,
    opacity: 0.7,
  },
  rowTime: {
    width: 56,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
  },
  rowTimeCancelled: {
    textDecorationLine: "line-through",
    color: theme.colors.muted,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  rowTitleCancelled: {
    textDecorationLine: "line-through",
    color: theme.colors.muted,
  },
  rowMeta: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cancelLabel: {
    color: theme.colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  eventBadge: {
    paddingHorizontal: theme.spacing(1) + 2,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
})

