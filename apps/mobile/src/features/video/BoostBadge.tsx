import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"

// Shown while a held finger plays the video at 2x (usePlayerGestures).
export function BoostBadge() {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.text}>2x ▶▶</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    badge: {
      position: "absolute",
      top: theme.spacing(3),
      alignSelf: "center",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.overlayStrong,
    },
    text: {
      color: theme.colors.onOverlay,
      fontSize: 14,
      fontWeight: "700",
    },
  })
