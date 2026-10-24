import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"

const BAR_AREA = 56

/** Check-ins per week as a row of bars, oldest first; the last bar is the current week. */
export function WeeklyBars({ counts }: { counts: number[] }) {
  const styles = useThemedStyles(makeStyles)
  const max = Math.max(1, ...counts)
  return (
    <View
      accessible
      accessibilityLabel={`Тренировки по неделям: ${counts.join(", ")}`}
      style={styles.wrap}
    >
      <View style={styles.bars}>
        {counts.map((c, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: Math.max(4, Math.round((BAR_AREA * c) / max)) },
              c > 0 && styles.barOn,
              c > 0 && i < counts.length - 1 && styles.barPast,
            ]}
          />
        ))}
      </View>
      <View style={styles.captions}>
        <Text style={styles.caption}>последние 12 недель</Text>
        <Text style={styles.caption}>сейчас</Text>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.spacing(1) },
    bars: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 4,
      height: BAR_AREA,
    },
    bar: {
      flex: 1,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.border,
    },
    barOn: { backgroundColor: theme.colors.accent },
    barPast: { opacity: 0.45 },
    captions: { flexDirection: "row", justifyContent: "space-between" },
    caption: { ...theme.typography.caption, color: theme.colors.muted },
  })
