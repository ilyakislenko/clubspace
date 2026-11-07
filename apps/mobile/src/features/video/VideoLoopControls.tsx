import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatPosition } from "./format-position"

type Props = {
  loopA: number | null
  loopB: number | null
  onSetA: () => void
  onSetB: () => void
  onClear: () => void
  // Keep the current A–B as a segment bookmark (offered once both are set).
  onSaveSegment: () => void
}

// The A–B repeat while one is set (started from the lesson's «⋯»): A, B
// (each re-marked at the current second on tap), save, clear. Nothing at all
// while no point is set.
export function VideoLoopControls({
  loopA,
  loopB,
  onSetA,
  onSetB,
  onClear,
  onSaveSegment,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (loopA == null && loopB == null) return null
  return (
    <View style={styles.row}>
      <Text style={styles.title}>Повтор</Text>
      <Pressable
        onPress={onSetA}
        accessibilityRole="button"
        accessibilityLabel={
          loopA != null
            ? `Точка A ${formatPosition(loopA)}, отметить заново`
            : "Отметить точку A"
        }
        style={[styles.point, loopA != null && styles.pointSet]}
      >
        <Text style={styles.pointText}>
          {loopA != null ? `A ${formatPosition(loopA)}` : "A"}
        </Text>
      </Pressable>
      <Pressable
        onPress={onSetB}
        accessibilityRole="button"
        accessibilityLabel={
          loopB != null
            ? `Точка B ${formatPosition(loopB)}, отметить заново`
            : "Отметить точку B"
        }
        style={[styles.point, loopB != null && styles.pointSet]}
      >
        <Text style={styles.pointText}>
          {loopB != null ? `B ${formatPosition(loopB)}` : "Отметить B"}
        </Text>
      </Pressable>
      <View style={styles.spacer} />
      {loopA != null && loopB != null && (
        <Pressable
          onPress={onSaveSegment}
          accessibilityRole="button"
          accessibilityLabel={`Сохранить отрезок ${formatPosition(loopA)}–${formatPosition(loopB)} в закладки`}
          hitSlop={6}
        >
          <Text style={styles.save}>Сохранить</Text>
        </Pressable>
      )}
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Выключить повтор A–B"
        style={styles.clear}
      >
        <Icon name="close" size={20} color={theme.colors.muted} />
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  title: { ...theme.typography.bodyStrong, color: theme.colors.text },
  point: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pointSet: { borderColor: theme.colors.accent },
  pointText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  spacer: { flex: 1 },
  save: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
  clear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
})
