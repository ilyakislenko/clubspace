import React from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import type { ClassBooking } from "../../shared/api/class-bookings"
import type { DropInBooking } from "../../shared/api/drop-ins"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { viewerRole } from "../personal-training/personal-training-helpers"
import { Pill } from "./OccurrenceSheet"
import { formatUpcomingLabel } from "./schedule-helpers"

const CARD_WIDTH = 220

/**
 * «Мои записи» as a compact strip above the calendar: the member's upcoming
 * guest bookings, places (and waitlist places) in booking-mode classes, and
 * confirmed personal sessions, soonest first, scrolled sideways so the grid
 * keeps the full width. A booking opens the class's sheet when `canOpen`
 * finds the class in the loaded schedule; otherwise it is plain. A personal
 * session always opens its request.
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
  // Guest bookings and class bookings, soonest first, as the same cards.
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
  ]
  const cards = [
    ...classRows.map((b) => ({
      key: b.id,
      startAt: b.startAt,
      when: formatUpcomingLabel(new Date(b.startAt), b.timezone, now),
      title: b.groupName,
      meta: b.gym ? b.gym.name : "Зал не указан",
      pill: b.pill,
      onPress: canOpen(b.occurrenceId) ? () => onOpen(b.occurrenceId) : undefined,
    })),
    ...personal.map((pt) => ({
      key: pt.id,
      startAt: pt.confirmedStartAt!,
      when: formatUpcomingLabel(new Date(pt.confirmedStartAt!), pt.timezone, now),
      title:
        meId && viewerRole(pt, meId) === "member"
          ? `Тренер: ${pt.coach.displayName}`
          : `Ученик: ${pt.member.displayName}`,
      meta: pt.gym ? pt.gym.name : "Зал не выбран",
      pill: "персональная",
      onPress: () => onOpenPersonal(pt),
    })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt))

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Мои записи</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
      >
        {cards.map((c) => {
          const inner = (
            <>
              <Text style={styles.when} numberOfLines={1}>
                {c.when}
              </Text>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {c.title}
              </Text>
              <View style={styles.cardFoot}>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {c.meta}
                </Text>
                <Pill label={c.pill} />
              </View>
            </>
          )
          return c.onPress ? (
            <Pressable
              key={c.key}
              onPress={c.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${c.when}, ${c.title}, ${c.meta}, ${c.pill}`}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              {inner}
            </Pressable>
          ) : (
            <View key={c.key} style={styles.card}>
              {inner}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.spacing(2) },
    title: { ...theme.typography.label },
    scroll: { flexGrow: 0 },
    row: { gap: theme.spacing(2) },
    card: {
      width: CARD_WIDTH,
      gap: 2,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
    },
    cardFoot: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    when: { ...theme.typography.captionStrong, color: theme.colors.text },
    cardTitle: { ...theme.typography.bodyStrong, color: theme.colors.text },
    cardMeta: { flex: 1, ...theme.typography.caption, color: theme.colors.muted },
    pressed: { opacity: 0.7 },
  })
