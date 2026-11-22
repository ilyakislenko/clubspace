import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { formatBadge } from "../../features/notifications/unread"
import type { Theme } from "../theme"
import { useThemedStyles } from "../theme-context"

/**
 * A small accent pill with a count («3», «99+») beside a button's label;
 * nothing at zero. Decorative: the control's own label says the number.
 */
export function CountBadge({ count }: { count: number }) {
  const styles = useThemedStyles(makeStyles)
  const text = formatBadge(count)
  if (!text) return null
  return (
    <View
      style={styles.badge}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    badge: {
      minWidth: 18,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    text: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.accentText,
    },
  })
