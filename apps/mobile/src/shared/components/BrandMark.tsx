import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { brand } from "../brand"
import type { Theme } from "../theme"
import { useThemedStyles } from "../theme-context"

/**
 * The app's mark above a welcome or sign-in title: the brand's first letter on
 * an accent tile, the way the app icon reads. Replaces the sport emoji that
 * stood in for a logo.
 */
export function BrandMark() {
  const styles = useThemedStyles(makeStyles)
  return (
    <View
      style={styles.tile}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Text style={styles.letter}>{brand.displayName.charAt(0).toUpperCase()}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      width: 72,
      height: 72,
      borderRadius: theme.radius.xl,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginBottom: theme.spacing(2),
    },
    letter: { fontSize: 36, fontWeight: "800", color: theme.colors.accentText },
  })
