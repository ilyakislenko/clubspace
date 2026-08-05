import { LinearGradient } from "expo-linear-gradient"
import React from "react"
import { StyleSheet, View } from "react-native"

import { useTheme } from "./theme-context"

/**
 * The app-wide background. For themes that declare a `backgroundGradient`
 * (glass) it renders a full-screen gradient behind the whole navigator; the
 * screens' own backgrounds are transparent so it shows through. Every other
 * theme gets a flat opaque backstop in its background colour, so a screen that
 * doesn't fully paint its own background never flashes white.
 */
export function ThemedBackground({ children }: { children: React.ReactNode }) {
  const theme = useTheme()

  if (theme.backgroundGradient) {
    return (
      <LinearGradient
        colors={[...theme.backgroundGradient] as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        {children}
      </LinearGradient>
    )
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
