import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { theme } from "../../shared/theme"

const formatPosition = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

type Props = {
  loopA: number | null
  loopB: number | null
  onSetA: () => void
  onSetB: () => void
  onClear: () => void
}

export function VideoLoopControls({
  loopA,
  loopB,
  onSetA,
  onSetB,
  onClear,
}: Props) {
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
        <Text style={styles.loopHint}>
          Отрезок зациклен. Снимите отметку, чтобы выключить.
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  loopBlock: {
    gap: theme.spacing(2),
    padding: theme.spacing(3),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
