import React from "react"
import { Switch as RNSwitch, type SwitchProps } from "react-native"

import { useTheme } from "../theme-context"

/**
 * The app's toggle: the accent track when on, the border colour when off.
 * Android also needs the thumb set — left alone it takes the native theme's
 * teal accent, which clashes with the brand track.
 */
export function Switch(props: Omit<SwitchProps, "trackColor" | "thumbColor">) {
  const theme = useTheme()
  return (
    <RNSwitch
      {...props}
      trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
      thumbColor={theme.colors.accentText}
    />
  )
}
