import Ionicons from "@expo/vector-icons/Ionicons"
import React from "react"
import { StyleSheet, Text } from "react-native"

import type { ColumnsBySizeClass } from "../shared/size-class"
import { Pressable } from "../shared/components/Pressable"
import { ResponsiveGrid } from "../shared/components/ResponsiveGrid"
import type { Theme } from "../shared/theme"
import { useTheme, useThemedStyles } from "../shared/theme-context"
import type { NavSection } from "./nav-sections"

// Tile height floor and icon size; tweak here when tuning on a tablet.
export const NAV_TILE_MIN_HEIGHT = 96
export const NAV_TILE_ICON_SIZE = 28

/**
 * The tablet counterpart of `NavRowList`: the same sections as a grid of
 * tappable tiles (icon over label). Only rendered on medium / expanded
 * windows; phones keep the row list.
 */
export function NavTileGrid({
  sections,
  onPress,
  columns,
}: {
  sections: readonly NavSection[]
  onPress: (route: NavSection["route"]) => void
  columns?: ColumnsBySizeClass
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <ResponsiveGrid columns={columns}>
      {sections.map((section) => (
        <Pressable
          key={section.route}
          onPress={() => onPress(section.route)}
          style={styles.tile}
        >
          {section.icon && (
            <Ionicons
              name={section.icon}
              size={NAV_TILE_ICON_SIZE}
              color={theme.colors.accent}
            />
          )}
          <Text style={styles.label}>{section.label}</Text>
        </Pressable>
      ))}
    </ResponsiveGrid>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      flexGrow: 1,
      minHeight: NAV_TILE_MIN_HEIGHT,
      justifyContent: "space-between",
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    label: {
      fontSize: 15,
      fontWeight: "600",
      color: theme.colors.text,
    },
  })
