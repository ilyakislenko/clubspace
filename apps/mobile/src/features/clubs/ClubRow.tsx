import Ionicons from "@expo/vector-icons/Ionicons"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  clubAccessibilityLabel,
  clubEmoji,
  clubRoleLabel,
  clubStatusLabel,
  unreadBadgeText,
  type ClubRowData,
} from "./club-switcher-helpers"

/**
 * One club in a list of the member's clubs — the switcher sheet and the
 * Profile «Клубы» block render the same row, so both always show the same
 * role / access / unread / muted state.
 */
export function ClubRow({
  club,
  current,
  onPress,
  onOpenSettings,
  disabled,
  last,
}: {
  club: ClubRowData
  current: boolean
  onPress: () => void
  /** Per-club settings (mute, leave); shows a gear beside the row. */
  onOpenSettings?: () => void
  disabled?: boolean
  last?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const status = clubStatusLabel(club)
  const badge = unreadBadgeText(club.unreadNotifications)

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={clubAccessibilityLabel(club, current)}
        accessibilityState={{ selected: current, disabled: !!disabled }}
        style={styles.main}
      >
        <View style={styles.emojiCircle}>
          <Text style={styles.emoji} aria-hidden>
            {clubEmoji(club.type)}
          </Text>
        </View>
        <View style={styles.text}>
          <Text
            style={[styles.name, current && styles.nameCurrent]}
            numberOfLines={1}
          >
            {club.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {clubRoleLabel(club)}
            {status && <Text style={styles.expired}>{` · ${status}`}</Text>}
          </Text>
        </View>
        {club.notificationsMuted && (
          <Ionicons
            name="notifications-off-outline"
            size={18}
            color={theme.colors.muted}
          />
        )}
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        {current ? (
          <Ionicons name="checkmark" size={22} color={theme.colors.accent} />
        ) : (
          !onOpenSettings && <Chevron style={styles.chevron} />
        )}
      </Pressable>
      {onOpenSettings && (
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={`Настройки клуба ${club.name}`}
          hitSlop={8}
          style={styles.settings}
        >
          <Ionicons
            name="settings-outline"
            size={20}
            color={theme.colors.muted}
          />
        </Pressable>
      )}
    </View>
  )
}

/**
 * «+ Добавить клуб» — the last row of a club list, opens the join-by-code
 * screen. In a child's profile it joins the child: «Вступить в клуб по коду».
 */
export function AddClubRow({
  onPress,
  forChild = false,
}: {
  onPress: () => void
  forChild?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const label = forChild ? "Вступить в клуб по коду" : "Добавить клуб"
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Ввести код другого клуба"
      style={[styles.row, styles.rowLast, styles.addRow]}
    >
      <View style={styles.emojiCircle}>
        <Ionicons name="add" size={22} color={theme.colors.accent} />
      </View>
      <Text style={styles.addText}>{label}</Text>
      <Chevron style={styles.chevron} />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    main: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
    },
    addRow: {
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
    },
    emojiCircle: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    emoji: { fontSize: 20 },
    text: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    nameCurrent: { fontWeight: "700", color: theme.colors.accent },
    subtitle: { fontSize: 13, color: theme.colors.muted },
    expired: { color: theme.colors.danger, fontWeight: "600" },
    badge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      color: theme.colors.accentText,
      fontSize: 12,
      fontWeight: "700",
    },
    chevron: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
    settings: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      alignSelf: "stretch",
      justifyContent: "center",
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.border,
    },
    addText: {
      flex: 1,
      color: theme.colors.accent,
      fontSize: 15,
      fontWeight: "600",
    },
  })
