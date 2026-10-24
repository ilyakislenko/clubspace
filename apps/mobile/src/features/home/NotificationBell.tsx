import Ionicons from "@expo/vector-icons/Ionicons"
import { useNavigation } from "@react-navigation/native"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { AppNavigation } from "../../app/navigation"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatBadge } from "../notifications/unread"
import { useUnreadNotificationsCount } from "../notifications/useUnreadNotificationsCount"

/** The inbox entry on Home: a bell with the unread count. */
export function NotificationBell() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const navigation = useNavigation<AppNavigation>()
  const count = useUnreadNotificationsCount()
  const badge = formatBadge(count)

  return (
    <Pressable
      onPress={() => navigation.navigate("Notifications")}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        badge ? `Уведомления, непрочитанных: ${badge}` : "Уведомления"
      }
      style={styles.bell}
    >
      <Ionicons
        name="notifications-outline"
        size={24}
        color={theme.colors.text}
      />
      {badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
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
    badge: {
      position: "absolute",
      top: -2,
      right: -2,
      minWidth: 18,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.accentText,
    },
  })
