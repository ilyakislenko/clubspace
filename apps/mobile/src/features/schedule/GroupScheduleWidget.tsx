import React, { useMemo } from "react"
import { StyleSheet, Text, View } from "react-native"

import type {
  GroupScheduleException,
  GroupScheduleSlot,
} from "../../shared/api/groups"
import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  findActiveGroupException,
  findNextSession,
  formatDuration,
  formatNextSessionLabel,
  formatSlotShort,
} from "./schedule-helpers"

type Props = {
  slots: GroupScheduleSlot[]
  exceptions: GroupScheduleException[]
  // Club zone the slot times are held in; omitted = device zone.
  timeZone?: string
}

export function GroupScheduleWidget({ slots, exceptions, timeZone }: Props) {
  const styles = useThemedStyles(makeStyles)
  // Not memoized: the widget can sit in a mounted tab for days, and "the next
  // session" is computed from the current time.
  const now = new Date()
  const next = findNextSession(slots, exceptions, now, timeZone)
  const activeVacation = findActiveGroupException(exceptions, now, timeZone)
  const sortedSlots = useMemo(
    () =>
      [...slots].sort(
        (a, b) =>
          a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
      ),
    [slots],
  )

  if (slots.length === 0) {
    return null
  }

  return (
    <View style={styles.wrap}>
      {next ? (
        <View style={styles.nextRow}>
          <Text style={styles.nextLabel}>{formatNextSessionLabel(next)}</Text>
          <Text style={styles.nextSubtle}>
            · {formatDuration(next.slot.durationMin)}
          </Text>
        </View>
      ) : (
        <Text style={styles.nextLabelMuted}>
          Ближайшая тренировка не найдена в ближайшие 2 недели
        </Text>
      )}

      <View style={styles.weekRow}>
        {sortedSlots.map((slot) => (
          <View key={slot.id} style={styles.chip}>
            <Text style={styles.chipText}>{formatSlotShort(slot)}</Text>
          </View>
        ))}
      </View>

      {activeVacation && (
        <View style={styles.vacationBanner}>
          <Text style={styles.vacationText}>
            🌴 Перерыв {activeVacation.fromDate} → {activeVacation.untilDate}
            {activeVacation.reason ? ` — ${activeVacation.reason}` : ""}
          </Text>
        </View>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  wrap: {
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  nextRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing(1),
    flexWrap: "wrap",
  },
  nextLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  nextLabelMuted: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  nextSubtle: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  weekRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(1),
  },
  chip: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  chipText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "500",
  },
  vacationBanner: {
    marginTop: theme.spacing(1),
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  vacationText: {
    color: theme.colors.text,
    fontSize: 12,
  },
})
