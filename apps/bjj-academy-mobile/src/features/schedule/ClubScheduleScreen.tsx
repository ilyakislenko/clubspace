import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useMemo } from "react"
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
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import {
  getMyGroups,
  getWorkspaceSchedule,
  type ScheduleEvent,
  type ScheduleSession,
  type WorkspaceSchedule,
} from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
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
  days = 14,
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
    // Bucket sessions by their own timezone. For multi-city clubs each
    // gym ships its own tz, so a Tomsk gym session lands under the
    // calendar day a Tomsk learner would expect even if the workspace
    // default is Moscow.
    const { dateKey } = formatTimeInTz(session.startAt, session.timezone)
    buckets.get(dateKey)?.sessions.push(session)
  }
  for (const event of schedule.events) {
    // Bucket events by their OWN timezone — that's the day the
    // organiser meant. Around midnight, an event tagged as Friday in
    // Asia/Krasnoyarsk may map to Saturday in workspace TZ; we honour
    // the organiser's day, not the workspace's interpretation.
    const { dateKey } = formatTimeInTz(event.startAt, event.timezone)
    buckets.get(dateKey)?.events.push(event)
  }
  return [...buckets.values()]
}

export function ClubScheduleScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

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

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<{
    schedule: WorkspaceSchedule
    coachGroupIds: string[]
  }>(
    workspace ? `schedule:${workspace.workspaceId}` : null,
    useCallback(async () => {
      const schedule = await getWorkspaceSchedule({
        workspaceId: workspace!.workspaceId,
        from: isoDate(range.from),
        to: isoDate(range.to),
      })
      // Best-effort: which groups this user coaches (for the mark affordance).
      let coachGroupIds: string[] = []
      try {
        const groups = await getMyGroups({
          workspaceId: workspace!.workspaceId,
        })
        coachGroupIds = groups
          .filter((g) => g.role === "coach")
          .map((g) => g.id)
      } catch {
        // Non-fatal — the schedule still renders without the mark affordance.
      }
      return { schedule, coachGroupIds }
    }, [workspace, range]),
  )

  const schedule = data?.schedule ?? null
  const coachGroupIds = useMemo(
    () => new Set(data?.coachGroupIds ?? []),
    [data],
  )

  if (!workspace) {
    return null
  }

  if (loading && !schedule) {
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
      <CenteredColumn>
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
        <View>
          <Text style={styles.title}>Расписание клуба</Text>
          <Text style={styles.subtitle}>
            На две недели вперёд. Время указано по часовому поясу клуба
            ({schedule?.timezone ?? "—"}).
          </Text>
        </View>

        {stale && schedule ? <OfflineNotice /> : null}

        {error && !schedule && (
          <ErrorRetry message={error} onRetry={refetch} />
        )}

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
                      onMark={
                        coachGroupIds.has(s.groupId) && !s.cancelled
                          ? () =>
                              navigation.navigate("SessionAttendance", {
                                slotId: s.slotId,
                                sessionDate: formatTimeInTz(
                                  s.startAt,
                                  s.timezone,
                                ).dateKey,
                                groupName: s.group.name,
                              })
                          : undefined
                      }
                    />
                  ))}
                  {bucket.events.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

function SessionRow({
  session,
  onMark,
}: {
  session: ScheduleSession
  onMark?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  // Render hour/minute in the SESSION's tz so a Tomsk-gym session shows
  // 19:00 even when a Moscow user opens the app.
  const { hourMinute } = formatTimeInTz(session.startAt, session.timezone)
  const coachName =
    [session.group.coach.firstname, session.group.coach.lastname]
      .filter(Boolean)
      .join(" ")
      .trim() || session.group.coach.email

  const inner = (
    <>
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
        {onMark && (
          <Text style={styles.markHint}>Отметить посещаемость →</Text>
        )}
      </View>
    </>
  )

  if (onMark) {
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onMark}
      >
        {inner}
      </Pressable>
    )
  }
  return (
    <View style={[styles.row, session.cancelled && styles.rowCancelled]}>
      {inner}
    </View>
  )
}

function EventRow({ event }: { event: ScheduleEvent }) {
  const styles = useThemedStyles(makeStyles)
  const { hourMinute } = formatTimeInTz(event.startAt, event.timezone)
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
        <Text style={styles.rowMetaTz}>{event.timezone}</Text>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
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
  rowMetaTz: {
    color: theme.colors.muted,
    fontSize: 11,
    marginTop: 2,
    fontFamily: undefined,
  },
  cancelLabel: {
    color: theme.colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  markHint: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  rowPressed: { opacity: 0.7 },
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
    color: theme.colors.accentText,
    fontSize: 10,
    fontWeight: "700",
  },
})

