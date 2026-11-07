import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { useThemedStyles } from "../../shared/theme-context"
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

export function VideoLoopControls({
  loopA,
  loopB,
  onSetA,
  onSetB,
  onClear,
  onSaveSegment,
}: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.loopBlock}>
      <View style={styles.loopHeader}>
        <Text style={styles.noteLabel}>A–B повтор</Text>
        {(loopA != null || loopB != null) && (
          <Pressable onPress={onClear} hitSlop={8}>
            <Text style={styles.loopClear}>Сброс</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.loopRow}>
        <Pressable onPress={onSetA} style={styles.loopButton}>
          <Text style={styles.loopButtonLabel}>A</Text>
          <Text style={styles.loopButtonValue}>
            {loopA != null ? formatPosition(loopA) : "—"}
          </Text>
        </Pressable>
        <Pressable onPress={onSetB} style={styles.loopButton}>
          <Text style={styles.loopButtonLabel}>B</Text>
          <Text style={styles.loopButtonValue}>
            {loopB != null ? formatPosition(loopB) : "—"}
          </Text>
        </Pressable>
      </View>
      {loopA != null && loopB != null && (
        <View style={styles.segmentRow}>
          <Text style={[styles.loopHint, styles.flex]}>
            Отрезок зациклен. Снимите отметку, чтобы выключить.
          </Text>
          <Pressable
            onPress={onSaveSegment}
            accessibilityRole="button"
            accessibilityLabel={`Сохранить отрезок ${formatPosition(loopA)}–${formatPosition(loopB)} в закладки`}
            style={styles.saveSegmentButton}
          >
            <Text style={styles.saveSegmentText}>Сохранить отрезок</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  loopBlock: {
    gap: theme.spacing(2),
    padding: theme.spacing(3),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  flex: { flex: 1 },
  saveSegmentButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  saveSegmentText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  loopHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  noteLabel: { ...theme.typography.label },
  loopClear: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.muted,
  },
  loopRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
  },
  loopButton: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    gap: 2,
  },
  loopButtonLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted,
    letterSpacing: 0.5,
  },
  loopButtonValue: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  loopHint: {
    ...theme.typography.caption,
  },
})
