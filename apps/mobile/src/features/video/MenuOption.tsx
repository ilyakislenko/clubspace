// The lesson's menus: the «⋯» trigger and one choice in a menu (a `Sheet`):
// a label, an optional second line, ticked when on. Actions (not
// destinations) — so no chevron, unlike `SheetRow`; a destructive one reads red.
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { choiceA11y } from "../../shared/choice-a11y"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

export function MenuOption({
  label,
  detail,
  role = "button",
  selected = false,
  disabled = false,
  destructive = false,
  onPress,
}: {
  label: string
  detail?: string
  role?: "radio" | "switch" | "button"
  selected?: boolean
  disabled?: boolean
  destructive?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      {...(role === "radio"
        ? choiceA11y("radio", selected, { disabled })
        : {
            accessibilityRole: role,
            accessibilityState: role === "button" ? { disabled } : { checked: selected, disabled },
          })}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <Text
          style={[styles.label, destructive && styles.destructive]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {selected && <Icon name="checkmark" size={20} color={theme.colors.accent} />}
    </Pressable>
  )
}

/** The «⋯» that opens a menu; `color` for use over the picture. */
export function MoreButton({
  onPress,
  onLongPress,
  hint,
  color,
}: {
  onPress: () => void
  onLongPress?: () => void
  // What the menu is for, read after «Ещё» (e.g. the row's name).
  hint?: string
  color?: string
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Ещё"
      accessibilityHint={hint}
      style={styles.more}
    >
      <Icon
        name="ellipsis-horizontal"
        size={20}
        color={color ?? theme.colors.muted}
      />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      minHeight: 48,
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    text: { flex: 1 },
    label: { ...theme.typography.body, color: theme.colors.text },
    destructive: { color: theme.colors.danger },
    detail: { ...theme.typography.caption, color: theme.colors.muted },
    disabled: { opacity: 0.5 },
    more: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  })