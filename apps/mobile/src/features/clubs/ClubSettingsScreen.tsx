import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  leaveWorkspace,
  setWorkspaceNotificationsMuted,
} from "../../shared/api/my-memberships"
import {
  listMyClubOrganizations,
  setMyOrganizationConsent,
  type MyClubOrganization,
} from "../../shared/api/organizations"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { Switch } from "../../shared/components/Switch"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  consentSwitchLabel,
  consentToast,
  federationLabel,
} from "../org-events/org-helpers"
import {
  clubSettingsView,
  leaveConfirm,
  leftToast,
  MUTE_HINT,
  muteToast,
} from "./club-settings-helpers"
import { ClubMonogram } from "./ClubMonogram"

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
            <ClubMonogram name={club.name} size={56} />
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
              />
            </View>
            <Text style={styles.hint}>{MUTE_HINT}</Text>
          </View>

          <FederationConsent workspaceId={workspaceId} />

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

// «Федерация «…»»: one card per federation the club is an active member of,
// with the person's switch (a guardian acting for a child decides for the
// child), the consent text and the policy. Nothing without a federation, or
// with federations off on the server.
function FederationConsent({ workspaceId }: { workspaceId: string }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { actingAs } = useAuth()
  const { showToast } = useToast()
  // Same key as the Home card and «События»: one answer everywhere.
  const orgs = useCachedResource<MyClubOrganization[]>(
    `my-orgs:${workspaceId}`,
    useCallback(async () => await listMyClubOrganizations({ workspaceId }), [workspaceId]),
  )
  const [pending, setPending] = useState<string | null>(null)
  if (!orgs.data || orgs.data.length === 0) return null
  const forChild = actingAs !== null

  const toggle = async (org: MyClubOrganization, granted: boolean) => {
    if (pending) return
    setPending(org.organizationId)
    try {
      const updated = await setMyOrganizationConsent({
        workspaceId,
        organizationId: org.organizationId,
        granted,
      })
      haptics.light()
      showToast(consentToast(updated.consentGranted))
      orgs.mutate((prev) =>
        (prev ?? []).map((o) => (o.organizationId === updated.organizationId ? updated : o)),
      )
    } catch (e) {
      showToast(errorMessage(e, "Не удалось сохранить согласие"), "error")
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      {orgs.data.map((org) => (
        <View key={org.organizationId} style={styles.card}>
          <Text style={styles.cardTitle}>{federationLabel(org.name)}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{consentSwitchLabel(forChild)}</Text>
            {pending === org.organizationId ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <Switch
                accessibilityLabel={`${consentSwitchLabel(forChild)}: ${org.name}`}
                value={org.consentGranted}
                onValueChange={(v) => void toggle(org, v)}
              />
            )}
          </View>
          <Text style={styles.hint}>{org.consentText}</Text>
          <Pressable
            onPress={() => void Linking.openURL(brand.legal.privacyUrl)}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={styles.link}>Политика конфиденциальности</Text>
          </Pressable>
        </View>
      ))}
    </>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { alignItems: "center", justifyContent: "center" },
    body: { padding: theme.spacing(5), gap: theme.spacing(5) },
    header: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
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
    cardTitle: { ...theme.typography.bodyStrong, color: theme.colors.text },
    link: { fontSize: 13, color: theme.colors.accent },
  })
