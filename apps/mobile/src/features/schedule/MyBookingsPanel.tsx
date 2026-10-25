import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { DropInBooking } from "../../shared/api/drop-ins"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { viewerRole } from "../personal-training/personal-training-helpers"
import { Pill } from "./OccurrenceSheet"
import { formatUpcomingLabel } from "./schedule-helpers"

/**
 * The member's upcoming guest bookings and confirmed personal sessions. A
 * booking opens the class's sheet when `onOpen` can find the class in the
 * loaded schedule; otherwise it is plain. A personal session always opens its
 * request.
 */
export function MyBookingsPanel({
  bookings,
  personal,
  meId,
  now,
  canOpen,
  onOpen,
  onOpenPersonal,
}: {
  bookings: DropInBooking[]
  personal: PersonalTraining[]
  meId: string | null
  now: Date
  canOpen: (booking: DropInBooking) => boolean
  onOpen: (booking: DropInBooking) => void
  onOpenPersonal: (pt: PersonalTraining) => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Мои записи</Text>
      {bookings.map((b) => {
        const label = formatUpcomingLabel(
          new Date(b.startAt),
          b.timezone,
          now,
        )
        const inner = (
          <>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {label} · {b.groupName}
              </Text>
              <Pill label="гость" />
            </View>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {b.gym ? b.gym.name : "Зал не указан"}
            </Text>
          </>
        )
        return canOpen(b) ? (
          <Pressable
            key={b.id}
            onPress={() => onOpen(b)}
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
