import { useNavigation } from "@react-navigation/native"
import React, { useCallback, useMemo } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { Pressable } from "../../shared/components/Pressable"
import { CenteredColumn } from "../../shared/components/CenteredColumn"

import {
  getMyGroups,
  getWorkspaceSchedule,
  type ScheduleEvent,
  type ScheduleSession,
  type WorkspaceSchedule,
} from "../../shared/api/groups"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { AppNavigation } from "../../app/navigation"
import {
  buildDayBuckets,
  formatTimeInTz,
  formatTimezoneLabel,
  withClasses,
} from "./club-schedule-buckets"

const isoDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ClubScheduleScreen() {
  const navigation = useNavigation<AppNavigation>()
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
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    )
  }

  const buckets = schedule ? withClasses(buildDayBuckets(schedule, 14)) : []
  const nothingScheduled = !!schedule && buckets.length === 0

  return (
    <View style={styles.root}>
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
        {schedule && !nothingScheduled && (
          <Text style={styles.subtitle}>
            На две недели вперёд. Время указано по часовому поясу клуба (
            {formatTimezoneLabel(schedule.timezone)}).
          </Text>
        )}

        {stale && schedule ? <OfflineNotice /> : null}

        {error && !schedule && (
          <ErrorRetry message={error} onRetry={refetch} />
        )}

        {nothingScheduled && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Расписание пока не опубликовано</Text>
            <Text style={styles.emptyText}>
              В ближайшие две недели нет ни тренировок, ни событий. Уточните
              расписание у тренера или администратора клуба.
            </Text>
            {isFeatureEnabled(workspace, "groups") && (
              <Pressable
                onPress={() => navigation.navigate("MyGroups")}
                style={styles.emptyButton}
              >
                <Text style={styles.emptyButtonText}>Мои группы</Text>
              </Pressable>
            )}
          </View>
        )}

        {buckets.map((bucket) => (
          <View key={bucket.dateKey} style={styles.dayBlock}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayLabel}>{bucket.dayLabel}</Text>
              <Text style={styles.dayDate}>{bucket.dateShort}</Text>
            </View>
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
          </View>
        ))}
      </ScrollView>
      </CenteredColumn>
    </View>
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
          <Text style={styles.eventBadge}>Событие</Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {event.title}
          </Text>
        </View>
        {event.gym && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {event.gym.name} · {event.gym.address}
          </Text>
        )}
        <Text style={styles.rowMetaTz}>
          {formatTimezoneLabel(event.timezone)}
        </Text>
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
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(6),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptyTitle: {
    ...theme.typography.bodyStrong,
    color: theme.colors.text,
    textAlign: "center",
  },
  emptyText: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  emptyButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing(2),
  },
  emptyButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "500",
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

