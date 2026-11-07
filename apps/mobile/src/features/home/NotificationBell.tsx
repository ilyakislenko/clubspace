import { useNavigation } from "@react-navigation/native"
import React from "react"
import { StyleSheet, View } from "react-native"

import type { AppNavigation } from "../../app/navigation"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useUnreadNotificationsCount } from "../notifications/useUnreadNotificationsCount"
import { formatBellCount } from "./home-helpers"

/**
 * The inbox entry on Home: a bell with a dot while something is unread. The
 * inbox is club news as much as anything to act on, so no count on the icon;
 * opening it marks everything seen.
 */
export function NotificationBell() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const navigation = useNavigation<AppNavigation>()
  const unread = formatBellCount(useUnreadNotificationsCount())

  return (
    <Pressable
      onPress={() => navigation.navigate("Notifications")}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"
      }
      style={styles.bell}
    >
      <Icon
        name="notifications-outline"
        size={24}
        color={theme.colors.text}
      />
      {unread && <View style={styles.dot} />}
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    bell: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    dot: {
      position: "absolute",
      top: 9,
      right: 10,
      width: 9,
      height: 9,
      borderRadius: theme.radius.full,
      borderWidth: 1.5,
      borderColor: theme.colors.surfaceMuted,
      backgroundColor: theme.colors.accent,
    },
  })
