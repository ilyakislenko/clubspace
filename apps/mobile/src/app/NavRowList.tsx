import Ionicons from "@expo/vector-icons/Ionicons"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { Chevron } from "../shared/components/Chevron"
import { Pressable } from "../shared/components/Pressable"
import type { Theme } from "../shared/theme"
import { useTheme, useThemedStyles } from "../shared/theme-context"
import type { NavSection } from "./nav-sections"

/** A card of tappable rows, one per section (Profile and Progress screens). */
export function NavRowList({
  sections,
  onPress,
}: {
  sections: readonly NavSection[]
  onPress: (route: NavSection["route"]) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.actionsBlock}>
      {sections.map((section, i) => (
        <Pressable
          key={section.route}
          onPress={() => onPress(section.route)}
          style={[
            styles.actionRow,
            i === sections.length - 1 && styles.actionRowLast,
          ]}
        >
          {section.icon && (
            <Ionicons
              name={section.icon}
              size={20}
              color={theme.colors.accent}
              style={styles.actionIcon}
            />
          )}
          <Text style={styles.actionLabel}>{section.label}</Text>
          <Chevron style={styles.actionChev} />
        </Pressable>
      ))}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    actionsBlock: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
      ...theme.shadows.sm,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(4),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    actionRowLast: { borderBottomWidth: 0 },
    actionIcon: { width: 22, textAlign: "center" },
    actionLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: "500",
      color: theme.colors.text,
    },
    actionChev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
  })
