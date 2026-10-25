import React from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { formatDuration } from "../schedule/schedule-helpers"
import {
  buildDateChoices,
  DURATION_CHOICES,
  isFutureWallClock,
  TIME_CHOICES,
  type TimeOptionValue,
} from "./personal-training-helpers"

/**
 * One proposed time: a day, a start time and a length, all picked from chips
 * (no native date picker). Days and times are in `timeZone`, the zone the
 * server will read them in; a time that has already passed there is disabled.
 */
export function TimeOptionPicker({
  value,
  onChange,
  timeZone,
}: {
  value: TimeOptionValue
  onChange: (next: TimeOptionValue) => void
  timeZone: string
}) {
  const styles = useThemedStyles(makeStyles)
  // Per render: the screen can stay open past a half-hour boundary.
  const now = new Date()
  const dates = buildDateChoices(now, timeZone)

  const pickDate = (dateKey: string) =>
    onChange({
      ...value,
      dateKey,
      // A time that is past on the newly picked day can't stay selected.
      time:
        value.time && isFutureWallClock(dateKey, value.time, timeZone, now)
          ? value.time
          : null,
    })

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rowScroll}
        contentContainerStyle={styles.row}
      >
        {dates.map((d) => {
          const selected = d.dateKey === value.dateKey
          return (
            <Pressable
              key={d.dateKey}
              onPress={() => pickDate(d.dateKey)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {d.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={styles.wrap}>
        {TIME_CHOICES.map((time) => {
          const selected = time === value.time
          const disabled =
            !value.dateKey ||
            !isFutureWallClock(value.dateKey, time, timeZone, now)
          return (
            <Pressable
              key={time}
              onPress={() => onChange({ ...value, time })}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              style={[
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
              ]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {time}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <View style={styles.wrap}>
        {DURATION_CHOICES.map((min) => {
          const selected = min === value.durationMin
          return (
            <Pressable
              key={min}
              onPress={() => onChange({ ...value, durationMin: min })}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {formatDuration(min)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.spacing(2) },
    rowScroll: { flexGrow: 0 },
    row: { gap: theme.spacing(2) },
    wrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing(2),
    },
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
    chipDisabled: { opacity: 0.35 },
    chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
    chipTextSelected: { color: theme.colors.accentText, fontWeight: "700" },
  })
