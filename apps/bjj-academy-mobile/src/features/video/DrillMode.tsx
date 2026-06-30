import React, { useEffect, useState } from "react"
import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  getPreferences,
  subscribePreferences,
} from "../profile/preferences-store"
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

// Floating action button — keeps the drill timer one tap away from any
// authed screen, not just the video player. When a drill is running it
// expands into a pill showing the live countdown so the user knows it's
// alive even with the modal hidden.
export function DrillModeFab() {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const insets = useSafeAreaInsets()
  const { phase, round, remaining } = useDrill()

  useEffect(() => {
    void getPreferences().then((p) => setEnabled(p.drillFabEnabled))
    return subscribePreferences((p) => setEnabled(p.drillFabEnabled))
  }, [])

  const running = isDrillRunning(phase)
  // While a drill is running, the FAB is also the only way back into the
  // modal — keep it visible even if the user disabled it in settings,
  // otherwise they'd be stuck with a timer they can't pause.
  if (!enabled && !running) return null
  const phaseHint =
    phase === "work" ? `R${round}` : phase === "rest" ? "Отдых" : "…"

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          running ? styles.fabPill : styles.fab,
          {
            bottom: Math.max(insets.bottom, theme.spacing(2)) + theme.spacing(4),
            right: theme.spacing(4),
          },
          phase === "rest" && styles.fabRest,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          running ? "Дрилл идёт — открыть таймер" : "Открыть дрилл-таймер"
        }
      >
        {running ? (
          <View style={styles.fabPillContent}>
            <Text style={styles.fabPillIcon}>⏱</Text>
            <View>
              <Text style={styles.fabPillHint}>{phaseHint}</Text>
              <Text style={styles.fabPillTime}>{formatClock(remaining)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.fabIcon}>⏱</Text>
        )}
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
    color: "#fff",
    fontVariant: ["tabular-nums"],
  },
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }
      : { elevation: 6 }),
  },
  fabIcon: {
    fontSize: 24,
    color: "#fff",
  },
  fabPill: {
    position: "absolute",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: 32,
    backgroundColor: theme.colors.accent,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 120,
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }
      : { elevation: 6 }),
  },
  fabRest: {
    backgroundColor: "#f4a261",
  },
  fabPillContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  fabPillIcon: {
    fontSize: 22,
    color: "#fff",
  },
  fabPillHint: {
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  fabPillTime: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    lineHeight: 18,
  },
})
