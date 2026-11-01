import { useNavigation } from "@react-navigation/native"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

import {
  getMyClassBookings,
  type MyClassBookings,
} from "../../shared/api/class-bookings"
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
import { fetchMyMembership } from "../../shared/api/memberships"
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
import { useResponsive } from "../../shared/useResponsive"
import type { AppNavigation } from "../../app/navigation"
import {
  upcomingConfirmed,
  viewerRole,
} from "../personal-training/personal-training-helpers"
import { isStaffWorkspace } from "../retention/retention-helpers"
import { DirectionChips } from "../directions/DirectionChips"
import { resolveDirectionFilter } from "../directions/direction-helpers"
import { DirectionTag } from "../directions/DirectionTag"
import { useDirections } from "../directions/useDirections"
import {
  MY_GROUPS_FILTER,
  filterSchedule,
  formatTimeInTz,
  formatTimezoneLabel,
  resolveScheduleFilter,
  scheduleChips,
  scheduleGyms,
} from "./club-schedule-buckets"
import { spotsLine, withMyBooking } from "./class-booking-helpers"
import { DayStrip } from "./DayStrip"
import { rsvpStateFor, type RsvpState } from "./drop-in-helpers"
import { loadGymFilter, saveGymFilter } from "./gym-filter-store"
import { MyBookingsPanel } from "./MyBookingsPanel"
import { OccurrenceSheet, Pill } from "./OccurrenceSheet"
import {
  CALENDAR_HORIZON_DAYS,
  CALENDAR_PAGES,
  CALENDAR_WIDE_MIN,
  DEFAULT_AXIS,
  blockStateLine,
  calendarItems,
  dayKeysFrom,
  fetchRange,
  fetchWindowOf,
  firstDayOfPage,
  fitTimeAxis,
  formatDayLong,
  formatWeekRange,
  pageOfDay,
  personName,
  placeOverlaps,
  segmentsByDay,
  shortPersonName,
  todayKeyIn,
  weekdayShort,
  windowDayKeys,
  zonedDayMinute,
  type PlacedSegment,
  type TimeAxis,
} from "./schedule-calendar"
import {
  canMarkSession,
  isAdminScope,
  substitutesFor,
  substitutionActions,
  substitutionLine,
  type StaffViewer,
} from "./substitution-helpers"
import { WeekCalendar, type CalendarBlockContent } from "./WeekCalendar"

const isoDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The club schedule as a calendar. Wide windows get a week grid (seven day
 * columns on a time axis) paged sideways by week; phones a day strip over the
 * picked day's list, or the same week grid in compact form. Days count from
 * the club's today; the schedule is fetched two weeks at a time as the member
 * pages forward.
 */
export function ClubScheduleScreen() {
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { width, height } = useResponsive()
  const wide = width >= CALENDAR_WIDE_MIN

  // The tab stays mounted for days, so "today" is read on every render and is
  // part of the cache key: when the date rolls over the window is refetched.
  const todayKey = isoDate(new Date())

  // Days from today the calendar is on: the picked day of the phone's strip,
  // and its week is the grid's page.
  const [dayOffset, setDayOffset] = useState(0)
  const [phoneView, setPhoneView] = useState<"day" | "week">("day")
  const fetchWindow = fetchWindowOf(dayOffset)

  // «Все» (null) or one direction — the server narrows the classes and
  // events. Offered only when the club has directions.
  const directions = useDirections(workspace?.workspaceId)
  const [pickedDirection, setPickedDirection] = useState<string | null>(null)
  const directionId = resolveDirectionFilter(pickedDirection, directions)

  const {
    data,
    error,
    loading,
    refreshing,
    stale,
    refetch,
    mutate,
  } = useCachedResource<{
    schedule: WorkspaceSchedule
    coachGroupIds: string[]
    // Optional: cached payloads predate it.
    memberGroupIds?: string[]
  }>(
    workspace
      ? `schedule:${workspace.workspaceId}:${todayKey}${fetchWindow ? `:w${fetchWindow}` : ""}${directionId ? `:${directionId}` : ""}`
      : null,
    useCallback(async () => {
      // Two weeks from the window's first day, padded by a day on each side
      // so a TZ shift between the device and the club can't slice off its
      // edges; the calendar picks the club's days out of the response.
      const range = fetchRange(todayKey, fetchWindow)
      const schedule = await getWorkspaceSchedule({
        workspaceId: workspace!.workspaceId,
        from: range.from,
        to: range.to,
        directionId,
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
    }, [workspace, directionId, todayKey, fetchWindow]),
  )

  const schedule = data?.schedule ?? null
  // While the next two weeks load, the chips, the zone and the axis stay as
  // the last window had them instead of blanking the screen.
  const lastLoaded = useRef<{
    workspaceId: string
    schedule: WorkspaceSchedule
    axis: TimeAxis
  } | null>(null)

  const coachGroupIds = useMemo(
    () => new Set(data?.coachGroupIds ?? []),
    [data],
  )

  const memberGroupIds = useMemo(
    () => new Set(data?.memberGroupIds ?? []),
    [data],
  )

  // Club staff run classes instead of booking them. The membership tells a
  // direction manager's directions and whether they mark every class
  // (admin scope, or a club that lets coaches mark any class). Same key as
  // Home's and Profile's, so each paints the other's data.
  const isStaff = isStaffWorkspace(workspace)
  const membership = useCachedResource(
    workspace && isStaff ? `membership:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        await fetchMyMembership({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  // Cached payloads from before the field have none.
  const managedDirectionIds = useMemo(
    () => new Set(membership.data?.managedDirectionIds ?? []),
    [membership.data],
  )

  // Staff (the owner included) have no abonement to book with, and run
  // classes rather than visit them: guest visits are for members.
  const guestVisitsOn =
    !!workspace && isFeatureEnabled(workspace, "guestVisits") && !isStaff
  // Fetched even with guest visits off: existing bookings stay visible and
  // cancellable (the server answers canBook: false).
  const dropIns = useCachedResource<MyDropIns>(
    workspace && !workspace.isOwner ? `dropins:me:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyDropIns({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )

  // «Мои записи» for booking-mode classes: the late-cancel switch and the
  // waitlist promotions behind the sheet, and the strip's list. Only
  // fetched while the schedule has such classes. Same key as the «Мои
  // записи» screen; refreshed by the `classbookings` invalidation.
  const hasBookingClasses = !!data?.schedule.sessions.some((s) => s.booking)
  const classBookings = useCachedResource<MyClassBookings>(
    workspace && hasBookingClasses
      ? `classbookings:${workspace.workspaceId}:mine`
      : null,
    useCallback(
      async () =>
        await getMyClassBookings({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )

  // Confirmed personal sessions share the calendar. Best-effort, like the
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

  const previous =
    lastLoaded.current?.workspaceId === workspace.workspaceId
      ? lastLoaded.current
      : null
  // The schedule the chips and the zone come from: this window's, else the
  // last one's while this one loads.
  const known = schedule ?? previous?.schedule ?? null

  if (loading && !known) {
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
  const viewer: StaffViewer = {
    meId,
    adminScope: isAdminScope(workspace),
    // Cached payloads from before the field have none: admin scope still
    // marks everything.
    marksAnyClass:
      membership.data?.marksAnyClass ?? isAdminScope(workspace),
    coachGroupIds,
    managedDirectionIds,
  }
  // Classes this user may mark and see guest bookings of.
  const coachesSession = (s: ScheduleSession): boolean =>
    canMarkSession(s, viewer)

  const gyms = known ? scheduleGyms(known) : []
  // «Мои группы»: classes of the groups the member studies in or coaches.
  const ownGroupIds = new Set([...memberGroupIds, ...coachGroupIds])
  const filterId = resolveScheduleFilter(storedGym, gyms, ownGroupIds.size > 0)
  const mineSelected = filterId === MY_GROUPS_FILTER
  const chips = scheduleChips(gyms, ownGroupIds.size > 0)

  // The calendar runs on the club's days: today first, twelve weeks ahead.
  const clubTz =
    known?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const clubToday = todayKeyIn(clubTz, now)
  const nowMinute = zonedDayMinute(now, clubTz).minute
  const dayKeys = dayKeysFrom(clubToday, CALENDAR_HORIZON_DAYS)
  const loadedKeys = schedule ? windowDayKeys(clubToday, fetchWindow) : []
  // Personal sessions are not filtered by gym or group: they belong to the
  // member.
  const byDay = segmentsByDay(
    schedule
      ? calendarItems(filterSchedule(schedule, filterId, ownGroupIds), personal)
      : [],
    loadedKeys,
  )
  const placed = new Map(
    [...byDay].map(([key, segs]) => [key, placeOverlaps(segs)] as const),
  )
  // The axis fits the whole club's classes of the window, so a gym chip
  // doesn't make the grid jump.
  const axis = schedule
    ? fitTimeAxis(
        [
          ...segmentsByDay(calendarItems(schedule, personal), loadedKeys).values(),
        ].flat(),
      )
    : (previous?.axis ?? DEFAULT_AXIS)
  if (schedule) {
    lastLoaded.current = { workspaceId: workspace.workspaceId, schedule, axis }
  }
  const busyDays = new Set(
    [...byDay].filter(([, segs]) => segs.length > 0).map(([key]) => key),
  )

  const filtered = !!filterId || !!directionId
  const windowEmpty = !!schedule && busyDays.size === 0
  const nothingScheduled = windowEmpty && !filtered && fetchWindow === 0
  const period =
    fetchWindow === 0 ? "на ближайшие две недели" : "в эти две недели"
  const emptyNote = !windowEmpty || nothingScheduled
    ? null
    : mineSelected
      ? `В ваших группах ${period} ничего нет.`
      : filterId
        ? `В этом зале ${period} ничего нет.`
        : directionId
          ? `В этом направлении ${period} ничего нет.`
          : `В эти две недели нет ни тренировок, ни событий.`

  const bookings = dropIns.data?.bookings ?? []
  const upcomingBookings = bookings.filter(
    (b) => !b.cancelled && new Date(b.endAt).getTime() > now,
  )
  const bookedOccurrenceIds = new Set(bookings.map((b) => b.occurrenceId))
  const upcomingClassBookings = (classBookings.data?.upcoming ?? []).filter(
    (b) =>
      (b.status === "BOOKED" || b.status === "WAITLISTED") &&
      new Date(b.endAt).getTime() > now,
  )
  const stateOf = (s: ScheduleSession): RsvpState =>
    rsvpStateFor(s, {
      featureOn: guestVisitsOn,
      isStaff,
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

  const guestsLineOf = (s: ScheduleSession): string | null =>
    coachesSession(s) && (s.bookedGuests ?? 0) > 0
      ? `Записались: ${s.bookedGuests} ${pluralRu(s.bookedGuests!, "гость", "гостя", "гостей")}`
      : null
  const markOf = (s: ScheduleSession): (() => void) | undefined =>
    coachesSession(s)
      ? () =>
          navigation.navigate("SessionAttendance", {
            slotId: s.slotId,
            sessionDate: formatTimeInTz(s.startAt, s.timezone).dateKey,
            groupName: s.group.name,
          })
      : undefined
  const openEvents = isFeatureEnabled(workspace, "events")
    ? () => navigation.navigate("Events")
    : undefined
  const openPersonal = (pt: PersonalTraining) =>
    navigation.navigate("PersonalTraining", { requestId: pt.id })

  // What a grid block says and does. A tap opens the class's sheet — for the
  // coach too, whose sheet carries «Отметить посещаемость».
  const describe = (seg: PlacedSegment): CalendarBlockContent => {
    const { item } = seg
    const start = formatTimeInTz(item.startAt, item.timezone).hourMinute
    const end = formatTimeInTz(item.endAt, item.timezone).hourMinute
    const past = new Date(item.endAt).getTime() <= now
    const day = `${weekdayShort(seg.dateKey)}, ${formatDayLong(seg.dateKey)}`
    const label = (parts: Array<string | null | false>) =>
      parts.filter(Boolean).join(", ")
    if (item.kind === "session") {
      const s = item.session
      const state = blockStateLine(
        s,
        bookedOccurrenceIds.has(s.occurrenceId) && !s.cancelled,
      )
      return {
        kind: "session",
        start,
        end,
        title: s.group.name,
        gym: s.group.gym?.name ?? null,
        person:
          s.substitution?.status === "APPROVED"
            ? `Замена: ${shortPersonName(s.substitution.substitute)}`
            : shortPersonName(s.group.coach),
        state,
        color: s.group.direction?.color ?? null,
        past,
        cancelled: s.cancelled,
        accessibilityLabel: label([
          `${day}, ${start}–${end}`,
          s.group.name,
          s.group.direction?.name ?? null,
          s.group.gym?.name ?? null,
          `тренер ${personName(s.group.coach)}`,
          substitutionLine(s, isStaff),
          memberGroupIds.has(s.groupId) && "ваша группа",
          // «11/12» reads badly aloud: the places in words instead.
          state?.tone === "normal" && s.booking
            ? spotsLine(s.booking)
            : (state?.text ?? null),
        ]),
        onPress: () => setOpenOccurrenceId(s.occurrenceId),
      }
    }
    if (item.kind === "event") {
      const e = item.event
      return {
        kind: "event",
        start,
        end,
        title: e.title,
        gym: e.gym?.name ?? null,
        person: e.coach ? shortPersonName(e.coach) : null,
        state: null,
        color: e.direction?.color ?? null,
        past,
        cancelled: false,
        accessibilityLabel: label([
          `Событие, ${day}, ${start}–${end}`,
          e.title,
          e.gym?.name ?? null,
        ]),
        onPress: openEvents,
      }
    }
    const pt = item.personal
    const who =
      meId && viewerRole(pt, meId) === "member"
        ? `Тренер: ${pt.coach.displayName}`
        : `Ученик: ${pt.member.displayName}`
    return {
      kind: "personal",
      start,
      end,
      title: "Персональная",
      gym: pt.gym?.name ?? null,
      person: who,
      state: null,
      color: null,
      past,
      cancelled: false,
      accessibilityLabel: label([
        `Персональная тренировка, ${day}, ${start}–${end}`,
        who,
        pt.gym?.name ?? null,
      ]),
      onPress: () => openPersonal(pt),
    }
  }

  const page = pageOfDay(dayOffset)
  const goToPage = (p: number) =>
    setDayOffset(firstDayOfPage(Math.min(CALENDAR_PAGES - 1, Math.max(0, p))))
  const goToDay = (offset: number) =>
    setDayOffset(Math.min(CALENDAR_HORIZON_DAYS - 1, Math.max(0, offset)))
  const weekTitle = formatWeekRange(
    dayKeys[firstDayOfPage(page)]!,
    dayKeys[firstDayOfPage(page) + 6]!,
  )
  const selectedKey = dayKeys[dayOffset]!
  const showWeek = wide || phoneView === "week"

  const weekGrid = (
    <WeekCalendar
      dayKeys={dayKeys}
      page={page}
      onPageChange={goToPage}
      days={placed}
      loading={!schedule}
      axis={axis}
      todayKey={clubToday}
      nowMinute={nowMinute}
      compact={!wide}
      // The hours scroll under the pinned day headers, a screen tall.
      viewportHeight={wide ? Math.max(360, height - 160) : undefined}
      describe={describe}
      onDayPress={
        wide
          ? undefined
          : (key) => {
              goToDay(dayKeys.indexOf(key))
              setPhoneView("day")
            }
      }
    />
  )

  // The phone's day: what starts on it, in time order.
  const daySegments = (placed.get(selectedKey) ?? []).filter(
    (seg) => !seg.continuesBefore,
  )
  const dayList = !schedule ? (
    <ActivityIndicator color={theme.colors.accent} style={styles.dayLoading} />
  ) : daySegments.length === 0 ? (
    <Text style={styles.emptyText}>В этот день ничего нет.</Text>
  ) : (
    <View style={styles.dayRows}>
      {daySegments.map(({ item }) =>
        item.kind === "session" ? (
          <SessionRow
            key={item.key}
            session={item.session}
            isOwnGroup={memberGroupIds.has(item.session.groupId)}
            booked={
              bookedOccurrenceIds.has(item.session.occurrenceId) &&
              !item.session.cancelled
            }
            classBooking={item.session.booking ?? null}
            guestsLine={guestsLineOf(item.session)}
            substitution={substitutionLine(item.session, isStaff)}
            canMark={coachesSession(item.session)}
            onOpen={() => setOpenOccurrenceId(item.session.occurrenceId)}
          />
        ) : item.kind === "personal" ? (
          <PersonalRow
            key={item.key}
            pt={item.personal}
            meId={meId}
            onPress={() => openPersonal(item.personal)}
          />
        ) : (
          <EventRow key={item.key} event={item.event} onPress={openEvents} />
        ),
      )}
    </View>
  )

  const navButton = (
    label: string,
    onPress: () => void,
    disabled: boolean,
    accessibilityLabel: string,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[styles.navButton, disabled && styles.navButtonDisabled]}
    >
      <Text style={styles.navButtonText}>{label}</Text>
    </Pressable>
  )

  const viewToggle = !wide && (
    <View style={styles.toggle}>
      {(["day", "week"] as const).map((v) => {
        const selected = phoneView === v
        return (
          <Pressable
            key={v}
            onPress={() => setPhoneView(v)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.toggleItem, selected && styles.toggleItemSelected]}
          >
            <Text
              style={[styles.toggleText, selected && styles.toggleTextSelected]}
            >
              {v === "day" ? "День" : "Неделя"}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )

  const calendarNav = showWeek ? (
    <View style={styles.navRow}>
      <Text style={styles.navTitle} accessibilityRole="header">
        {weekTitle}
      </Text>
      <View style={styles.navButtons}>
        {viewToggle}
        {navButton("‹", () => goToPage(page - 1), page === 0, "Предыдущая неделя")}
        {navButton("Сегодня", () => goToPage(0), page === 0, "К сегодняшнему дню")}
        {navButton(
          "›",
          () => goToPage(page + 1),
          page >= CALENDAR_PAGES - 1,
          "Следующая неделя",
        )}
      </View>
    </View>
  ) : (
    <View style={styles.navRow}>
      <Text style={styles.navTitle} accessibilityRole="header">
        {dayOffset === 0
          ? "Сегодня"
          : dayOffset === 1
            ? "Завтра"
            : weekdayShort(selectedKey)}
        , {formatDayLong(selectedKey)}
      </Text>
      <View style={styles.navButtons}>
        {viewToggle}
        {navButton("‹", () => goToDay(dayOffset - 1), dayOffset === 0, "Предыдущий день")}
        {navButton(
          "›",
          () => goToDay(dayOffset + 1),
          dayOffset >= CALENDAR_HORIZON_DAYS - 1,
          "Следующий день",
        )}
      </View>
    </View>
  )

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
        {known && !nothingScheduled && (
          <Text style={styles.subtitle}>
            Время указано по часовому поясу клуба (
            {formatTimezoneLabel(clubTz)}).
          </Text>
        )}

        {stale && schedule ? <OfflineNotice /> : null}

        {error && !schedule && (
          <ErrorRetry message={error} onRetry={refetch} />
        )}

        <DirectionChips
          directions={directions}
          selectedId={directionId}
          onSelect={setPickedDirection}
        />

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

        {(coachesAvailable > 0 || (hasBookingClasses && !workspace.isOwner)) && (
          <View style={styles.links}>
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
            {hasBookingClasses && !workspace.isOwner && (
              <Pressable
                onPress={() => navigation.navigate("MyClassBookings")}
                accessibilityRole="button"
                style={({ pressed }) => [styles.personalLink, pressed && styles.rowPressed]}
              >
                <Text style={styles.personalLinkText}>Мои записи на занятия →</Text>
              </Pressable>
            )}
          </View>
        )}

        {(upcomingBookings.length > 0 ||
          upcomingClassBookings.length > 0 ||
          personal.length > 0) && (
          <MyBookingsPanel
            bookings={upcomingBookings}
            classBookings={upcomingClassBookings}
            personal={personal}
            meId={meId}
            now={new Date(now)}
            canOpen={(occurrenceId) =>
              !!schedule?.sessions.some((s) => s.occurrenceId === occurrenceId)
            }
            onOpen={setOpenOccurrenceId}
            onOpenPersonal={openPersonal}
          />
        )}

        {nothingScheduled ? (
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
        ) : (
          <>
            {calendarNav}
            {!showWeek && (
              <DayStrip
                dayKeys={dayKeys}
                selected={dayOffset}
                onSelect={goToDay}
                busyDays={busyDays}
              />
            )}
            {emptyNote && <Text style={styles.emptyText}>{emptyNote}</Text>}
            {showWeek ? weekGrid : dayList}
          </>
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
          myClassBooking={
            upcomingClassBookings.find(
              (b) => b.occurrenceId === openSession.occurrenceId,
            ) ?? null
          }
          guestsLine={guestsLineOf(openSession)}
          staff={
            isStaff
              ? {
                  actions: substitutionActions(openSession, viewer, now),
                  onChanged: () => refetch(),
                }
              : null
          }
          substituting={substitutesFor(openSession, meId)}
          onMark={
            markOf(openSession)
              ? () => {
                  setOpenOccurrenceId(null)
                  markOf(openSession)!()
                }
              : undefined
          }
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
          onClassBookingChanged={(result) => {
            // Paint the member's place now; the refetches bring the
            // server's counts (a cancel may have promoted somebody).
            mutate((prev) =>
              prev
                ? {
                    ...prev,
                    schedule: {
                      ...prev.schedule,
                      sessions: prev.schedule.sessions.map((s) =>
                        s.occurrenceId === openSession.occurrenceId && s.booking
                          ? { ...s, booking: withMyBooking(s.booking, result) }
                          : s,
                      ),
                    },
                  }
                : prev,
            )
            refetch()
            classBookings.refetch()
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
  classBooking,
  guestsLine,
  substitution,
  canMark,
  onOpen,
}: {
  session: ScheduleSession
  isOwnGroup: boolean
  booked: boolean
  // The booking-mode class's places and the viewer's own booking.
  classBooking: ScheduleSession["booking"] | null
  guestsLine: string | null
  // «Замена: И. Фамилия» (staff also see a pending request).
  substitution: string | null
  // The viewer may mark the class: its sheet opens on «Отметить посещаемость».
  canMark: boolean
  onOpen: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  // Render hour/minute in the SESSION's tz so a Tomsk-gym session shows
  // 19:00 even when a Moscow user opens the app.
  const { hourMinute } = formatTimeInTz(session.startAt, session.timezone)
  const coachName = personName(session.group.coach)

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
          {classBooking?.myBookingId && classBooking.myStatus === "BOOKED" && (
            <Pill label="Вы записаны" />
          )}
          {classBooking?.myBookingId &&
            classBooking.myStatus === "WAITLISTED" && (
              <Pill
                label={
                  classBooking.myWaitlistPosition
                    ? `Лист ожидания · №${classBooking.myWaitlistPosition}`
                    : "Лист ожидания"
                }
              />
            )}
          <DirectionTag direction={session.group.direction} />
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {session.group.gym
            ? `${session.group.gym.name} · ${session.group.gym.address}`
            : "Зал не указан"}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          Тренер: {coachName}
        </Text>
        {substitution && (
          <Text style={styles.rowSpots} numberOfLines={1}>
            {substitution}
          </Text>
        )}
        {classBooking && !session.cancelled && (
          <Text style={styles.rowSpots} numberOfLines={1}>
            {spotsLine(classBooking)}
          </Text>
        )}
        {session.cancelled && (
          <Text style={styles.cancelLabel}>
            Отменено
            {session.cancellationReason
              ? ` — ${session.cancellationReason}`
              : ""}
          </Text>
        )}
        {guestsLine && <Text style={styles.markHint}>{guestsLine}</Text>}
        {canMark && (
          <Text style={styles.markHint}>Отметить посещаемость →</Text>
        )}
      </View>
    </>
  )

  // Everyone opens the class's sheet: staff find «Отметить посещаемость»
  // and the substitution actions there, members the booking.
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        session.cancelled && styles.rowCancelled,
        pressed && styles.rowPressed,
      ]}
      onPress={onOpen}
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
        <DirectionTag direction={event.direction} />
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
  navRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  navTitle: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  navButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  navButton: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: theme.spacing(3),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  navButtonDisabled: { opacity: 0.4 },
  navButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  toggle: {
    flexDirection: "row",
    padding: 2,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  toggleItem: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
  },
  toggleItemSelected: { backgroundColor: theme.colors.accent },
  toggleText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  toggleTextSelected: { color: theme.colors.accentText },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing(5),
  },
  dayLoading: { paddingVertical: theme.spacing(6) },
  dayRows: { gap: theme.spacing(1) },
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
  rowSpots: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
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

