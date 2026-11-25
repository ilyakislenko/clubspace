import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { clubMonogram } from "./club-switcher-helpers"

/**
 * A club's avatar: the first letter of its name in a soft accent circle. Clubs
 * have no logo yet, and a sport emoji per club type read as clip-art.
 */
export function ClubMonogram({ name, size = 40 }: { name: string; size?: number }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View
      style={[styles.circle, { width: size, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.42) }]}>
        {clubMonogram(name)}
      </Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    circle: {
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    letter: { fontWeight: "700", color: theme.colors.accent },
  })
