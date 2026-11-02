import React, { useState } from "react"
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  bookClass,
  cancelClassBooking,
  type ClassBooking,
} from "../../shared/api/class-bookings"
import {
  cancelDropIn,
  createDropIn,
  type DropInBooking,
} from "../../shared/api/drop-ins"
import type { ScheduleSession } from "../../shared/api/groups"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import {
  bookedToast,
  burnLine,
  cancelPrompt,
  classBookingActionFor,
  formatDayMonth,
  formatDeadline,
  isLateCancel,
  spotsLine,
} from "./class-booking-helpers"
import type { RsvpState } from "./drop-in-helpers"
import { formatTimeInTz } from "./club-schedule-buckets"
import {
  foreignTzSuffix,
  formatDuration,
  formatSessionStart,
} from "./schedule-helpers"
import { StaffClassActions } from "./StaffClassActions"
import {
  substitutionLine,
  type SubstitutionAction,
} from "./substitution-helpers"

// A small status tag next to a group name («Ваша группа», «Вы записаны»).
export function Pill({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles)
  return <Text style={styles.pill}>{label}</Text>
}

const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s

/**
 * One class of the club schedule, opened by a tap: the details, and — for a
 * member, a class of another group — the «Приду на тренировку» booking; for a
 * class of a booking-mode group the places, «Записаться» and the waitlist.
 * Staff never get a member's booking: whoever may mark the class gets
 * «Отметить посещаемость», and every coach the substitution actions
 * («Назначить замену», «Взять занятие», approve / decline). A bottom sheet on
 * phones, a centered card on larger windows.
 */
export function OccurrenceSheet({
  session,
  state,
  isOwnGroup,
  booking,
  blockedReason,
  myClassBooking,
  onClose,
  onBooked,
  onCancelled,
  onClassBookingChanged,
  guestsLine = null,
  onMark,
  staff = null,
  substituting = false,
}: {
  session: ScheduleSession
  state: RsvpState
  isOwnGroup: boolean
  // The member's booking for this class, when they have one.
  booking: DropInBooking | null
  blockedReason: string | null
  // The member's booking of this booking-mode class from «Мои записи», when
  // loaded: tells whether a late cancel burns a class.
  myClassBooking: ClassBooking | null
  onClose: () => void
  onBooked: (booking: DropInBooking) => void
  onCancelled: (bookingId: string) => void
  onClassBookingChanged: (booking: ClassBooking) => void
  // For the class's coach: «Записались: 2 гостя», and the attendance roll.
  guestsLine?: string | null
  onMark?: () => void
  // Set for club staff: the substitution actions this class offers them.
  staff?: { actions: SubstitutionAction[]; onChanged: () => void } | null
  // The viewer is this class's approved substitute.
  substituting?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { sizeClass, height } = useResponsive()
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const coachName =
    [session.group.coach.firstname, session.group.coach.lastname]
      .filter(Boolean)
      .join(" ")
      .trim() || session.group.coach.email

  const book = async () => {
    if (!workspace || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createDropIn({
        workspaceId: workspace.workspaceId,
        slotId: session.slotId,
        sessionDate: formatTimeInTz(session.startAt, session.timezone).dateKey,
      })
      haptics.success()
      showToast("Вы записаны на тренировку", "success")
      onBooked(created)
    } catch (e) {
      // The server explains why (frozen, no classes left, …) — show it as is.
      setError(errorMessage(e, "Не удалось записаться"))
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!workspace || !booking || busy) return
    setBusy(true)
    setError(null)
    try {
      await cancelDropIn({
        workspaceId: workspace.workspaceId,
        bookingId: booking.id,
      })
      haptics.success()
      showToast("Запись отменена", "success")
      onCancelled(booking.id)
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить запись"))
      setBusy(false)
    }
  }

  const confirmCancel = () =>
    showAlert(
      "Отменить запись?",
      "Тренер получит уведомление, что вы не придёте.",
      [
        { text: "Нет", style: "cancel" },
        {
          text: "Отменить запись",
          style: "destructive",
          onPress: () => void cancel(),
        },
      ],
    )

  // A booking-mode class: null for a fixed group's. Staff run classes, they
  // don't book them.
  const spots = session.booking ?? null
  const now = Date.now()
  const action = spots && !staff ? classBookingActionFor(session, spots, now) : null
  const subLine = substitutionLine(session, !!staff)
  const sessionDate = formatTimeInTz(session.startAt, session.timezone).dateKey

  const bookPlace = async () => {
    if (!workspace || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await bookClass({
        workspaceId: workspace.workspaceId,
        slotId: session.slotId,
        sessionDate,
      })
      haptics.success()
      showToast(bookedToast(created), "success")
      onClassBookingChanged(created)
    } catch (e) {
      // The server explains why (no abonement, not open yet, …) — as is.
      setError(errorMessage(e, "Не удалось записаться"))
      setBusy(false)
    }
  }

  const cancelPlace = async (bookingId: string) => {
    if (!workspace || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await cancelClassBooking({
        workspaceId: workspace.workspaceId,
        bookingId,
      })
      haptics.success()
      const burned = burnLine(result)
      showToast(
        spots?.myStatus === "WAITLISTED"
          ? "Вы покинули лист ожидания"
          : burned
            ? `Запись отменена. ${burned}`
            : "Запись отменена",
        "success",
      )
      onClassBookingChanged(result)
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить запись"))
      setBusy(false)
    }
  }

  const confirmCancelPlace = () => {
    if (!spots?.myBookingId || !spots.myStatus) return
    const bookingId = spots.myBookingId
    const prompt = cancelPrompt({
      status: spots.myStatus,
      late: isLateCancel(
        { status: spots.myStatus, cancelDeadline: spots.cancelDeadline },
        now,
        myClassBooking?.lateCancelNow,
      ),
      promoted: !!myClassBooking?.promotedAt,
      cancelDeadline: spots.cancelDeadline,
      timezone: session.timezone,
      burns: myClassBooking ? myClassBooking.lateCancelBurns : null,
    })
    showAlert(prompt.title, prompt.message, [
      { text: "Нет", style: "cancel" },
      {
        text: prompt.confirm,
        style: "destructive",
        onPress: () => void cancelPlace(bookingId),
      },
    ])
  }

  const deadline = spots
    ? formatDeadline(spots.cancelDeadline, session.timezone)
    : ""

  const compact = sizeClass === "compact"

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, compact ? styles.backdropBottom : styles.backdropCenter]}
        onPress={onClose}
        onAccessibilityEscape={onClose}
        // Structural, not a control: it only catches taps outside the sheet.
        accessibilityRole="none"
      >
        <Pressable
          style={[
            styles.sheet,
            compact ? styles.sheetBottom : styles.sheetCenter,
            {
              maxHeight: height * 0.9,
              // Android draws edge-to-edge: keep the buttons above the
              // system navigation bar.
              paddingBottom: theme.spacing(5) + (compact ? insets.bottom : 0),
            },
          ]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap inside the sheet doesn't dismiss it */
          }}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.titleRow}>
              <Text style={styles.title}>{session.group.name}</Text>
              {isOwnGroup && <Pill label="Ваша группа" />}
              {substituting && <Pill label="Вы ведёте замену" />}
              {booking && <Pill label="Вы записаны" />}
              {!staff && spots?.myBookingId && spots.myStatus === "BOOKED" && (
                <Pill label="Вы записаны" />
              )}
              {!staff && spots?.myBookingId && spots.myStatus === "WAITLISTED" && (
                <Pill label="Лист ожидания" />
              )}
            </View>
            <Text style={styles.when}>
              {capitalize(formatSessionStart(session.startAt, session.timezone))}
              {` · ${formatDuration(session.durationMin)}`}
              {foreignTzSuffix(session.timezone, new Date(session.startAt))}
            </Text>
            <Text style={styles.meta}>
              {session.group.gym
                ? `${session.group.gym.name} · ${session.group.gym.address}`
                : "Зал не указан"}
            </Text>
            <Text style={styles.meta}>Тренер: {coachName}</Text>
            {subLine && (
              <Text
                style={
                  session.substitution?.status === "APPROVED"
                    ? styles.spots
                    : styles.muted
                }
              >
                {subLine}
              </Text>
            )}

            {session.cancelled && (
              <Text style={styles.danger}>
                Тренировка отменена
                {session.cancellationReason
                  ? ` — ${session.cancellationReason}`
                  : ""}
              </Text>
            )}
            {state === "own_group" && (
              <Text style={styles.muted}>
                Это ваша группа — приходите без записи.
              </Text>
            )}
            {state === "started" && (
              <Text style={styles.muted}>
                Тренировка уже началась — запись закрыта.
              </Text>
            )}
            {state === "blocked" && blockedReason && (
              <Text style={styles.muted}>{blockedReason}</Text>
            )}
            {state === "booked" && (
              <Text style={styles.success}>
                Вы записаны — тренер знает, что вы придёте.
              </Text>
            )}
            {state === "can_book" && (
              <Text style={styles.muted}>
                Занятие спишется с абонемента, только когда вас отметят на
                тренировке.
              </Text>
            )}
            {spots && !session.cancelled && (
              <Text style={styles.spots}>{spotsLine(spots)}</Text>
            )}
            {guestsLine && <Text style={styles.spots}>{guestsLine}</Text>}
            {action === "started" && (
              <Text style={styles.muted}>
                Занятие уже началось — запись закрыта.
              </Text>
            )}
            {action === "cancel" && (
              <>
                <Text style={styles.success}>
                  {myClassBooking?.promotedAt
                    ? "Вас записали из листа ожидания."
                    : "Вы записаны на занятие."}
                </Text>
                <Text style={styles.muted}>
                  {now > new Date(spots!.cancelDeadline).getTime()
                    ? `Срок бесплатной отмены прошёл (${deadline}).`
                    : `Бесплатно отменить можно до ${deadline}.`}
                </Text>
              </>
            )}
            {action === "leave_waitlist" && (
              <Text style={styles.success}>
                {spots?.myWaitlistPosition
                  ? `Вы в листе ожидания, место №${spots.myWaitlistPosition}.`
                  : "Вы в листе ожидания."}{" "}
                Если место освободится, вас запишут автоматически и пришлют
                уведомление.
              </Text>
            )}
            {action === "not_open" && (
              <Text style={styles.muted}>
                Запись откроется {formatDayMonth(spots!.opensOn)}.
              </Text>
            )}
            {action === "waitlist" && (
              <Text style={styles.muted}>
                Если место освободится, вас запишут автоматически по очереди.
              </Text>
            )}
            {action === "book" && (
              <Text style={styles.muted}>
                Бесплатно отменить можно до {deadline}. Занятие спишется с
                абонемента, когда вас отметят на тренировке.
              </Text>
            )}

            {error && <Text style={styles.danger}>{error}</Text>}

            {onMark && (
              <Pressable
                onPress={onMark}
                accessibilityRole="button"
                style={[styles.button, styles.buttonPrimary]}
              >
                <Text style={styles.buttonPrimaryText}>
                  Отметить посещаемость
                </Text>
              </Pressable>
            )}
            {staff && (
              <StaffClassActions
                session={session}
                actions={staff.actions}
                onChanged={staff.onChanged}
              />
            )}
            {state === "can_book" && (
              <Pressable
                onPress={() => void book()}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.button, styles.buttonPrimary]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>
                    Приду на тренировку
                  </Text>
                )}
              </Pressable>
            )}
            {(action === "book" || action === "waitlist") && (
              <Pressable
                onPress={() => void bookPlace()}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.button, styles.buttonPrimary]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>
                    {action === "book"
                      ? "Записаться"
                      : "Встать в лист ожидания"}
                  </Text>
                )}
              </Pressable>
            )}
            {(action === "cancel" || action === "leave_waitlist") && (
              <Pressable
                onPress={confirmCancelPlace}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.button, styles.buttonSecondary]}
              >
                <Text style={styles.buttonSecondaryText}>
                  {busy
                    ? "Отменяем…"
                    : action === "cancel"
                      ? myClassBooking?.promotedAt
                        ? "Отказаться"
                        : "Отменить запись"
                      : "Покинуть лист ожидания"}
                </Text>
              </Pressable>
            )}
            {state === "booked" && booking && (
              <Pressable
                onPress={confirmCancel}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.button, styles.buttonSecondary]}
              >
                <Text style={styles.buttonSecondaryText}>
                  {busy ? "Отменяем…" : "Отменить запись"}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={[styles.button, styles.buttonSecondary]}
            >
              <Text style={styles.buttonSecondaryText}>Закрыть</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.colors.overlay },
    backdropBottom: { justifyContent: "flex-end" },
    backdropCenter: {
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      backgroundColor: theme.colors.surfaceElevated,
      paddingTop: theme.spacing(5),
      paddingHorizontal: theme.spacing(5),
      ...theme.shadows.sm,
    },
    sheetBottom: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    sheetCenter: { maxWidth: 460, borderRadius: theme.radius.lg },
    scroll: { flexGrow: 0 },
    content: { gap: theme.spacing(3) },
    titleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    title: {
      flexShrink: 1,
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.text,
    },
    pill: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
      overflow: "hidden",
    },
    when: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted },
    muted: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
    spots: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
    success: { fontSize: 14, fontWeight: "600", color: theme.colors.success },
    danger: { fontSize: 13, color: theme.colors.danger },
    button: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonPrimaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
  })
