import Ionicons from "@expo/vector-icons/Ionicons"
import { useNavigation } from "@react-navigation/native"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { AppNavigation } from "../../app/navigation"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { invitationsBannerText } from "./invitation-helpers"
import { useMyInvitations } from "./useMyInvitations"

// Home: pending club invitations, one tap from the Invitations screen. Renders
// nothing when there are none (or the list couldn't load — not worth an error
// on Home).
export function InvitationsBanner() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const navigation = useNavigation<AppNavigation>()
  const { invitations } = useMyInvitations()
  const text = invitationsBannerText(invitations ?? [])
  if (!text) return null

  return (
    <Pressable
      onPress={() => navigation.navigate("Invitations")}
      accessibilityRole="button"
      accessibilityHint="Открыть приглашения"
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
    >
      <Ionicons name="mail-unread-outline" size={22} color={theme.colors.accent} />
      <View style={styles.text}>
        <Text style={styles.title}>{text}</Text>
        <Text style={styles.hint}>Посмотреть и ответить</Text>
      </View>
      <Chevron style={styles.chev} />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accentSoft,
    },
    pressed: { opacity: 0.85 },
    text: { flex: 1, gap: 2 },
    title: { ...theme.typography.bodyStrong, color: theme.colors.text },
    hint: { fontSize: 13, color: theme.colors.textSecondary },
    chev: { fontSize: 20, color: theme.colors.accent, lineHeight: 20 },
  })
