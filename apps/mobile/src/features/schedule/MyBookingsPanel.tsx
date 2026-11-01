import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { ClassBooking } from "../../shared/api/class-bookings"
import type { DropInBooking } from "../../shared/api/drop-ins"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { viewerRole } from "../personal-training/personal-training-helpers"
import { Pill } from "./OccurrenceSheet"
import { formatUpcomingLabel } from "./schedule-helpers"

/**
 * The member's upcoming guest bookings, places (and waitlist places) in
 * booking-mode classes, and confirmed personal sessions. A booking opens the
 * class's sheet when `canOpen` finds the class in the loaded schedule;
 * otherwise it is plain. A personal session always opens its request.
 */
export function MyBookingsPanel({
  bookings,
  classBookings,
  personal,
  meId,
  now,
  canOpen,
  onOpen,
  onOpenPersonal,
}: {
  bookings: DropInBooking[]
  classBookings: ClassBooking[]
  personal: PersonalTraining[]
  meId: string | null
  now: Date
  canOpen: (occurrenceId: string) => boolean
  onOpen: (occurrenceId: string) => void
  onOpenPersonal: (pt: PersonalTraining) => void
}) {
  const styles = useThemedStyles(makeStyles)
  // Guest bookings and class bookings, soonest first, as the same rows.
  const classRows = [
    ...classBookings.map((b) => ({
      ...b,
      pill:
        b.status === "WAITLISTED"
          ? b.waitlistPosition
            ? `ожидание · №${b.waitlistPosition}`
            : "ожидание"
          : "запись",
    })),
    ...bookings.map((b) => ({ ...b, pill: "гость" })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt))
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Мои записи</Text>
      {classRows.map((b) => {
        const inner = (
          <>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {formatUpcomingLabel(new Date(b.startAt), b.timezone, now)} ·{" "}
                {b.groupName}
              </Text>
              <Pill label={b.pill} />
            </View>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {b.gym ? b.gym.name : "Зал не указан"}
            </Text>
          </>
        )
        return canOpen(b.occurrenceId) ? (
          <Pressable
            key={b.id}
            onPress={() => onOpen(b.occurrenceId)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {inner}
          </Pressable>
        ) : (
          <View key={b.id} style={styles.row}>
            {inner}
          </View>
        )
      })}
      {personal.map((pt) => {
        const who =
          meId && viewerRole(pt, meId) === "member"
            ? `Тренер: ${pt.coach.displayName}`
            : `Ученик: ${pt.member.displayName}`
        return (
          <Pressable
            key={pt.id}
            onPress={() => onOpenPersonal(pt)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {formatUpcomingLabel(
                  new Date(pt.confirmedStartAt!),
                  pt.timezone,
                  now,
                )}{" "}
                · {who}
              </Text>
              <Pill label="персональная" />
            </View>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {pt.gym ? pt.gym.name : "Зал не выбран"}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    title: { ...theme.typography.label },
    row: { gap: 2, paddingVertical: theme.spacing(1) },
    rowHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    rowTitle: {
      flex: 1,
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
    },
    rowMeta: { ...theme.typography.caption, color: theme.colors.muted },
    pressed: { opacity: 0.7 },
  })
