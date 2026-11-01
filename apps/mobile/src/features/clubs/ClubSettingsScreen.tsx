import { brandFromWorkspaceType } from "@clubspace/ui-kit/brand"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  leaveWorkspace,
  setWorkspaceNotificationsMuted,
} from "../../shared/api/my-memberships"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  clubSettingsView,
  leaveConfirm,
  leftToast,
  MUTE_HINT,
  muteToast,
} from "./club-settings-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "ClubSettings">

export function ClubSettingsScreen({ navigation, route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspaces, refresh } = useAuth()
  const { showToast } = useToast()
  const { workspaceId } = route.params
  const club = workspaces.find((w) => w.workspaceId === workspaceId)
  // The switch follows the tap at once; the club list catches up on refresh.
  const [pendingOn, setPendingOn] = useState<boolean | null>(null)
  const [leaving, setLeaving] = useState(false)

  if (!club) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.muted}>Вы не состоите в этом клубе</Text>
      </View>
    )
  }

  const view = clubSettingsView(club)
  const notificationsOn = pendingOn ?? view.notificationsOn

  const toggleNotifications = async (on: boolean) => {
    if (pendingOn !== null) return
    setPendingOn(on)
    try {
      const res = await setWorkspaceNotificationsMuted(workspaceId, !on)
      haptics.light()
      showToast(muteToast(res.notificationsMuted))
      // So notificationsMuted is current everywhere (switcher, Profile).
      await refresh()
    } catch (e) {
      showAlert(
        "Не удалось изменить уведомления",
        errorMessage(e, "Попробуйте ещё раз."),
      )
    } finally {
      setPendingOn(null)
    }
  }

  const leave = async () => {
    setLeaving(true)
    // The last club: the app swaps to onboarding by itself and this route is
    // gone, so there is nothing to go back to.
    const lastClub = workspaces.length === 1
    try {
      await leaveWorkspace(workspaceId)
    } catch (e) {
      // The owner and a group's primary coach are refused with the reason.
      showAlert("Не удалось покинуть клуб", errorMessage(e, "Попробуйте ещё раз."))
      setLeaving(false)
      return
    }
    haptics.success()
    showToast(leftToast(view.name), "success")
    // Picks another club as active, or onboarding when none is left.
    await refresh()
    if (!lastClub && navigation.canGoBack()) navigation.goBack()
  }

  const confirmLeave = () => {
    if (leaving) return
    const { title, message, confirm } = leaveConfirm(view.name)
    showAlert(title, message, [
      { text: "Отмена", style: "cancel" },
      { text: confirm, style: "destructive", onPress: () => void leave() },
    ])
  }

  return (
    <View style={styles.root}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.header}>
            <Text
              style={styles.icon}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              aria-hidden
            >
              {brandFromWorkspaceType(club.type).emoji}
            </Text>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={2}>
                {view.name}
              </Text>
              <Text style={styles.muted}>{view.roleLabel}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Уведомления клуба</Text>
              <Switch
                accessibilityLabel={`Уведомления клуба ${view.name}`}
                value={notificationsOn}
                disabled={pendingOn !== null}
                onValueChange={(v) => void toggleNotifications(v)}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            </View>
            <Text style={styles.hint}>{MUTE_HINT}</Text>
          </View>

          {view.canLeave && (
            <View style={styles.danger}>
              <Text style={styles.sectionTitle}>Опасная зона</Text>
              <Pressable
                onPress={confirmLeave}
                disabled={leaving}
                accessibilityRole="button"
                accessibilityLabel={`Покинуть клуб ${view.name}`}
                style={({ pressed }) => [
                  styles.dangerBtn,
                  pressed && styles.pressed,
                ]}
              >
                {leaving ? (
                  <ActivityIndicator color={theme.colors.danger} />
                ) : (
                  <Text style={styles.dangerText}>Покинуть клуб</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </CenteredColumn>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { alignItems: "center", justifyContent: "center" },
    body: { padding: theme.spacing(5), gap: theme.spacing(5) },
    header: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
    icon: { fontSize: 36 },
    headerText: { flex: 1, gap: 2 },
    title: { ...theme.typography.heading, color: theme.colors.text },
    muted: { fontSize: 14, color: theme.colors.muted },
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      gap: theme.spacing(2),
      ...theme.shadows.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
    },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: "500", color: theme.colors.text },
    hint: { fontSize: 13, lineHeight: 18, color: theme.colors.muted },
    danger: { gap: theme.spacing(2) },
    sectionTitle: {
      ...theme.typography.label,
      paddingHorizontal: theme.spacing(1),
    },
    dangerBtn: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.dangerSoft,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
    },
    dangerText: { color: theme.colors.danger, fontSize: 15, fontWeight: "700" },
    pressed: { opacity: 0.85 },
  })
