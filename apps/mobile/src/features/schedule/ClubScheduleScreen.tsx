import { useNavigation } from "@react-navigation/native"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { Pressable } from "../../shared/components/Pressable"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { SplitLayout } from "../../shared/components/SplitLayout"

import {
  getMyDropIns,
  type DropInBooking,
  type MyDropIns,
} from "../../shared/api/drop-ins"
import {
  getMyGroups,
  getWorkspaceSchedule,
  type ScheduleEvent,
  type ScheduleSession,
  type WorkspaceSchedule,
} from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import {
  listPersonalTrainings,
  type PersonalTraining,
  type PersonalTrainingList,
} from "../../shared/api/personal-trainings"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { pluralRu } from "../../shared/format-ru"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { AppNavigation } from "../../app/navigation"
import {
  upcomingConfirmed,
  viewerRole,
} from "../personal-training/personal-training-helpers"
import {
  buildDayBuckets,
  MY_GROUPS_FILTER,
  filterSchedule,
  formatTimeInTz,
  formatTimezoneLabel,
  resolveScheduleFilter,
  scheduleChips,
  scheduleGyms,
  withClasses,
} from "./club-schedule-buckets"
import { rsvpStateFor, type RsvpState } from "./drop-in-helpers"
import { loadGymFilter, saveGymFilter } from "./gym-filter-store"
import { MyBookingsPanel } from "./MyBookingsPanel"
import { OccurrenceSheet, Pill } from "./OccurrenceSheet"

const isoDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ClubScheduleScreen() {
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  // The tab stays mounted for days, so "today" is read on every render and is
  // part of the cache key: when the date rolls over the window is refetched.
  const todayKey = isoDate(new Date())

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
    // Optional: cached payloads predate it.
    memberGroupIds?: string[]
  }>(
    workspace ? `schedule:${workspace.workspaceId}:${todayKey}` : null,
    useCallback(async () => {
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
      const schedule = await getWorkspaceSchedule({
        workspaceId: workspace!.workspaceId,
        from: isoDate(start),
        to: isoDate(end),
      })
      // Best-effort: which groups this user coaches (for the mark affordance).
      let coachGroupIds: string[] = []
      let memberGroupIds: string[] = []
      try {
        const groups = await getMyGroups({
          workspaceId: workspace!.workspaceId,
        })
        coachGroupIds = groups
          .filter((g) => g.role === "coach")
          .map((g) => g.id)
        memberGroupIds = groups
          .filter((g) => g.role === "student")
          .map((g) => g.id)
      } catch {
        // Non-fatal — the schedule still renders without the mark affordance.
      }
      return { schedule, coachGroupIds, memberGroupIds }
    }, [workspace]),
  )

  const schedule = data?.schedule ?? null
  const coachGroupIds = useMemo(
    () => new Set(data?.coachGroupIds ?? []),
    [data],
  )

  const memberGroupIds = useMemo(
    () => new Set(data?.memberGroupIds ?? []),
    [data],
  )

  // The owner has no abonement to book with, so guest visits are for members.
  const guestVisitsOn =
    !!workspace && isFeatureEnabled(workspace, "guestVisits") && !workspace.isOwner
  // Fetched even with guest visits off: existing bookings stay visible and
  // cancellable (the server answers canBook: false).
  const dropIns = useCachedResource<MyDropIns>(
    workspace && !workspace.isOwner ? `dropins:me:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyDropIns({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )

  // Confirmed personal sessions share the day grid. Best-effort, like the
  // guest bookings: a failure never replaces the schedule with an error.
  const personalList = useCachedResource<PersonalTrainingList>(
    workspace ? `personal-trainings:me:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        await listPersonalTrainings({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  // Same key as Home's. Tells «Тренер: …» from «Ученик: …» on a personal row.
  const me = useCachedResource(
    workspace ? `me:${workspace.workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )

  // The gym chip last picked in this club; a gym that has since left the
  // schedule falls back to «Все залы» (see resolveGymFilter) without
  // forgetting the stored choice.
  const [storedGym, setStoredGym] = useState<string | null>(null)
  const workspaceId = workspace?.workspaceId
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void loadGymFilter(workspaceId).then((id) => {
      if (!cancelled) setStoredGym(id)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // The class whose sheet is open (by occurrenceId).
  const [openOccurrenceId, setOpenOccurrenceId] = useState<string | null>(null)

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

  // Never memoized: the tab stays mounted for days.
  const now = Date.now()
  const personal = upcomingConfirmed(
    personalList.data?.data ?? [],
    new Date(now),
  )
  const coachesAvailable = personalList.data?.coachesAvailable ?? 0
  const meId = me.data?.id ?? null

  const gyms = schedule ? scheduleGyms(schedule) : []
  // «Мои группы»: classes of the groups the member studies in or coaches.
  const ownGroupIds = new Set([...memberGroupIds, ...coachGroupIds])
  const filterId = resolveScheduleFilter(storedGym, gyms, ownGroupIds.size > 0)
  const mineSelected = filterId === MY_GROUPS_FILTER
  // Personal sessions are not filtered by gym or group: they belong to the
  // member.
  const buckets = schedule
    ? withClasses(
        buildDayBuckets(
          filterSchedule(schedule, filterId, ownGroupIds),
          14,
          now,
          personal,
        ),
      )
    : []
  const nothingScheduled = !!schedule && buckets.length === 0 && !filterId
  const nothingInGym = !!schedule && buckets.length === 0 && !!filterId
  const chips = scheduleChips(gyms, ownGroupIds.size > 0)

  const bookings = dropIns.data?.bookings ?? []
  const upcomingBookings = bookings.filter(
    (b) => !b.cancelled && new Date(b.endAt).getTime() > now,
  )
  const bookedOccurrenceIds = new Set(bookings.map((b) => b.occurrenceId))
  const stateOf = (s: ScheduleSession): RsvpState =>
    rsvpStateFor(s, {
      featureOn: guestVisitsOn,
      isOwner: workspace.isOwner,
      memberGroupIds,
      coachGroupIds,
      bookedOccurrenceIds,
      canBook: dropIns.data?.canBook ?? false,
      now,
    })
  const openSession = openOccurrenceId
    ? (schedule?.sessions.find((s) => s.occurrenceId === openOccurrenceId) ??
      null)
    : null

  const pickGym = (id: string | null) => {
    setStoredGym(id)
    void saveGymFilter(workspace.workspaceId, id)
  }

  const dayBlocks = buckets.map((bucket) => (
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
            isOwnGroup={memberGroupIds.has(s.groupId)}
            booked={bookedOccurrenceIds.has(s.occurrenceId) && !s.cancelled}
            guestsLine={
              coachGroupIds.has(s.groupId) && (s.bookedGuests ?? 0) > 0
                ? `Записались: ${s.bookedGuests} ${pluralRu(s.bookedGuests!, "гость", "гостя", "гостей")}`
                : null
            }
            onMark={
              coachGroupIds.has(s.groupId) && !s.cancelled
                ? () =>
                    navigation.navigate("SessionAttendance", {
                      slotId: s.slotId,
                      sessionDate: formatTimeInTz(s.startAt, s.timezone)
                        .dateKey,
                      groupName: s.group.name,
                    })
                : undefined
            }
            onOpen={() => setOpenOccurrenceId(s.occurrenceId)}
          />
        ))}
        {bucket.personal.map((pt) => (
          <PersonalRow
            key={pt.id}
            pt={pt}
            meId={meId}
            onPress={() =>
              navigation.navigate("PersonalTraining", { requestId: pt.id })
            }
          />
        ))}
        {bucket.events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            onPress={
              isFeatureEnabled(workspace, "events")
                ? () => navigation.navigate("Events")
                : undefined
            }
          />
        ))}
      </View>
    </View>
  ))

  return (
    <View style={styles.root}>
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

        {(gyms.length >= 2 || ownGroupIds.size > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
          >
            {chips.map((g) => {
              const selected = g.id === filterId
              return (
                <Pressable
                  key={g.id ?? "all"}
                  onPress={() => pickGym(g.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text
                    style={[styles.chipText, selected && styles.chipTextSelected]}
                  >
                    {g.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        {coachesAvailable > 0 && (
          <Pressable
            onPress={() => navigation.navigate("PersonalTrainings")}
            accessibilityRole="button"
            style={({ pressed }) => [styles.personalLink, pressed && styles.rowPressed]}
          >
            <Text style={styles.personalLinkText}>
              Персональная тренировка с тренером →
            </Text>
          </Pressable>
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

        {nothingInGym && (
          <Text style={styles.emptyText}>
            {mineSelected
              ? "В ваших группах на ближайшие две недели ничего нет."
              : "В этом зале на ближайшие две недели ничего нет."}
          </Text>
        )}

        {upcomingBookings.length > 0 || personal.length > 0 ? (
          <SplitLayout
            sidePosition="end"
            stackSideFirst
            side={
              <MyBookingsPanel
                bookings={upcomingBookings}
                personal={personal}
                meId={meId}
                now={new Date(now)}
                canOpen={(b) =>
                  !!schedule?.sessions.some(
                    (s) => s.occurrenceId === b.occurrenceId,
                  )
                }
                onOpen={(b) => setOpenOccurrenceId(b.occurrenceId)}
                onOpenPersonal={(pt) =>
                  navigation.navigate("PersonalTraining", {
                    requestId: pt.id,
                  })
                }
              />
            }
            main={
              <ResponsiveGrid columns={{ medium: 2, expanded: 2 }}>
                {dayBlocks}
              </ResponsiveGrid>
            }
          />
        ) : (
          <ResponsiveGrid>{dayBlocks}</ResponsiveGrid>
        )}
      </ScrollView>
      </CenteredColumn>

      {openSession && (
        <OccurrenceSheet
          session={openSession}
          state={stateOf(openSession)}
          isOwnGroup={memberGroupIds.has(openSession.groupId)}
          booking={
            bookings.find((b) => b.occurrenceId === openSession.occurrenceId) ??
            null
          }
          blockedReason={dropIns.data?.blockedReason ?? null}
          onClose={() => setOpenOccurrenceId(null)}
          onBooked={(booking: DropInBooking) => {
            dropIns.mutate((prev) =>
              prev
                ? {
                    ...prev,
                    bookings: [
                      ...prev.bookings.filter((b) => b.id !== booking.id),
                      booking,
                    ].sort((a, b) => a.startAt.localeCompare(b.startAt)),
                  }
                : prev,
            )
            setOpenOccurrenceId(null)
          }}
          onCancelled={(bookingId) => {
            dropIns.mutate((prev) =>
              prev
                ? {
                    ...prev,
                    bookings: prev.bookings.filter((b) => b.id !== bookingId),
                  }
                : prev,
            )
            setOpenOccurrenceId(null)
          }}
        />
      )}
    </View>
  )
}

function SessionRow({
  session,
  isOwnGroup,
  booked,
  guestsLine,
  onMark,
  onOpen,
}: {
  session: ScheduleSession
  isOwnGroup: boolean
  booked: boolean
  guestsLine: string | null
  onMark?: () => void
  onOpen: () => void
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
        <View style={styles.rowTitleLine}>
          <Text
            style={[
              styles.rowTitle,
              session.cancelled && styles.rowTitleCancelled,
            ]}
          >
            {session.group.name}
          </Text>
          {isOwnGroup && <Pill label="Ваша группа" />}
          {booked && <Pill label="Вы записаны" />}
        </View>
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
        {guestsLine && <Text style={styles.markHint}>{guestsLine}</Text>}
        {onMark && (
          <Text style={styles.markHint}>Отметить посещаемость →</Text>
        )}
      </View>
    </>
  )

  // A coach goes straight to marking; everyone else opens the class's sheet.
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        session.cancelled && styles.rowCancelled,
        pressed && styles.rowPressed,
      ]}
      onPress={onMark ?? onOpen}
    >
      {inner}
    </Pressable>
  )
}

function PersonalRow({
  pt,
  meId,
  onPress,
}: {
  pt: PersonalTraining
  meId: string | null
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const { hourMinute } = formatTimeInTz(pt.confirmedStartAt!, pt.timezone)
  const who =
    meId && viewerRole(pt, meId) === "member"
      ? `Тренер: ${pt.coach.displayName}`
      : `Ученик: ${pt.member.displayName}`
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        styles.rowEvent,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <Text style={styles.rowTime}>{hourMinute}</Text>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle}>Персональная тренировка</Text>
          <Pill label="Персональная" />
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {who}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {pt.gym ? `${pt.gym.name} · ${pt.gym.address}` : "Зал не выбран"}
        </Text>
        <Text style={styles.rowMetaTz}>{formatTimezoneLabel(pt.timezone)}</Text>
      </View>
    </Pressable>
  )
}

function EventRow({
  event,
  onPress,
}: {
  event: ScheduleEvent
  onPress?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const { hourMinute } = formatTimeInTz(event.startAt, event.timezone)
  const inner = (
    <>
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
    </>
  )
  if (!onPress) return <View style={[styles.row, styles.rowEvent]}>{inner}</View>
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        styles.rowEvent,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      {inner}
    </Pressable>
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
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
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
  rowTitleLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  personalLink: {
    alignSelf: "flex-start",
    paddingVertical: theme.spacing(1),
  },
  personalLinkText: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: "600",
  },
  chipsScroll: { flexGrow: 0 },
  chips: { gap: theme.spacing(2) },
  chip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipSelected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  chipTextSelected: { color: theme.colors.accentText, fontWeight: "700" },
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

