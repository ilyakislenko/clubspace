import React, { useEffect, useRef } from "react"
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { dayOfMonth, formatDayLong, weekdayShort } from "./schedule-calendar"

const CHIP_WIDTH = 48
const CHIP_GAP = 6
// Chips kept visible to the left of the picked one, so the past-ward
// neighbours stay in reach.
const LEAD_CHIPS = 2

/**
 * The phone's day picker: today first, then every day ahead, swiped sideways.
 * A dot marks a day with something on it (of the loaded days).
 */
export function DayStrip({
  dayKeys,
  selected,
  onSelect,
  busyDays,
}: {
  dayKeys: readonly string[]
  // Index into `dayKeys`.
  selected: number
  onSelect: (index: number) => void
  busyDays: ReadonlySet<string>
}) {
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollViewInstance>(null)

  // Keep the picked day in view (a «Сегодня» tap or a ‹ › step moves it).
  useEffect(() => {
    scrollRef.current?.scrollTo({
      x: Math.max(0, (selected - LEAD_CHIPS) * (CHIP_WIDTH + CHIP_GAP)),
      y: 0,
      animated: true,
    })
  }, [selected])

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {dayKeys.map((key, i) => {
        const isSelected = i === selected
        const today = i === 0
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${today ? "Сегодня, " : ""}${weekdayShort(key)}, ${formatDayLong(key)}${busyDays.has(key) ? ", есть занятия" : ""}`}
            style={[
              styles.chip,
              today && styles.chipToday,
              isSelected && styles.chipSelected,
            ]}
          >
            <Text style={[styles.weekday, isSelected && styles.textSelected]}>
              {today ? "Сег" : weekdayShort(key)}
            </Text>
            <Text style={[styles.day, isSelected && styles.textSelected]}>
              {dayOfMonth(key)}
            </Text>
            <View
              style={[
                styles.dot,
                busyDays.has(key) && styles.dotBusy,
                busyDays.has(key) && isSelected && styles.dotSelected,
              ]}
            />
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    row: { gap: CHIP_GAP },
    chip: {
      width: CHIP_WIDTH,
      paddingVertical: theme.spacing(2),
      alignItems: "center",
      gap: 2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipToday: { borderColor: theme.colors.accent },
    chipSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    weekday: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.muted,
      textTransform: "uppercase",
    },
    day: { fontSize: 17, fontWeight: "700", color: theme.colors.text },
    textSelected: { color: theme.colors.accentText },
    dot: { width: 5, height: 5, borderRadius: 3 },
    dotBusy: { backgroundColor: theme.colors.accent },
    dotSelected: { backgroundColor: theme.colors.accentText },
  })
