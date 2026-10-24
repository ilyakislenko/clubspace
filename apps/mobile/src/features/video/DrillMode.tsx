import React, { useState } from "react"
import { StyleSheet, Text } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatClock, isDrillRunning, useDrill } from "./drill-context"
import { DrillModal } from "./DrillModal"

// Public surface lives in drill-context; re-exported here so existing
// `from "./DrillMode"` imports (App provider, screens) keep working.
export { DrillProvider, useDrill, isDrillRunning } from "./drill-context"

type ButtonProps = {
  style?: object
}

export function DrillModeButton({ style }: ButtonProps) {
  const styles = useThemedStyles(makeStyles)
  const [open, setOpen] = useState(false)
  const { phase, remaining } = useDrill()
  const running = isDrillRunning(phase)

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          running ? "Дрилл идёт — открыть таймер" : "Открыть дрилл-таймер"
        }
        style={[styles.triggerButton, running && styles.triggerButtonRunning, style]}
      >
        <Text
          style={[
            styles.triggerText,
            running && styles.triggerTextRunning,
          ]}
        >
          {running ? `⏱ ${formatClock(remaining)}` : "⏱ Дрилл"}
        </Text>
      </Pressable>
      {open && <DrillModal onClose={() => setOpen(false)} />}
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  triggerButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerButtonRunning: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  triggerText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  triggerTextRunning: {
    color: theme.colors.accentText,
    fontVariant: ["tabular-nums"],
  },
})
