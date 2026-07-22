import { BlurView } from "expo-blur"
import React from "react"
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"

import { useTheme } from "./theme-context"

/**
 * A themed surface. The look is driven entirely by the active theme so the
 * whole app reforms when you switch:
 *  - glass  → a frosted BlurView over the app gradient
 *  - neu    → a soft "extruded" surface (dual light+dark shadow on iOS)
 *  - others → a flat card with the theme's shadow + hairline border
 *
 * Pass layout only (padding / gap / margin) via `style`; the Card owns the
 * surface colour, radius, border and shadow.
 */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const r = theme.radius.lg

  if (theme.key === "glass") {
    return (
      <BlurView
        intensity={26}
        tint={theme.scheme === "dark" ? "dark" : "light"}
        style={[
          styles.clip,
          { borderRadius: r, borderColor: theme.colors.border },
        ]}
      >
        <View style={[{ backgroundColor: theme.colors.surface }, style]}>
          {children}
        </View>
      </BlurView>
    )
  }

  if (theme.key === "neu") {
    // Dual shadow: outer casts the dark side, inner the light side. iOS only —
    // Android gets a single elevation from the inner view.
    const [darkSh, lightSh] =
      theme.scheme === "dark"
        ? ["#1f2130", "#35384a"]
        : ["#c5c7d0", "#ffffff"]
    return (
      <View
        style={{
          borderRadius: r,
          shadowColor: darkSh,
          shadowOpacity: 1,
          shadowRadius: 8,
          shadowOffset: { width: 5, height: 5 },
        }}
      >
        <View
          style={[
            {
              borderRadius: r,
              backgroundColor: theme.colors.surface,
              shadowColor: lightSh,
              shadowOpacity: 1,
              shadowRadius: 8,
              shadowOffset: { width: -5, height: -5 },
              elevation: 3,
            },
            style,
          ]}
        >
          {children}
        </View>
      </View>
    )
  }

  return (
    <View
      style={[
        {
          borderRadius: r,
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        theme.shadows.md,
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", borderWidth: 1 },
})
