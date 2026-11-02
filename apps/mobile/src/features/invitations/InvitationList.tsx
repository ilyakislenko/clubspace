import { brandFromWorkspaceType } from "@clubspace/ui-kit/brand"
import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  acceptInvitation,
  declineInvitation,
  type AcceptInvitationResult,
  type Invitation,
} from "../../shared/api/invitations"
import { useAuth } from "../../shared/auth-context"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  acceptedToast,
  declineConfirm,
  invitationMeta,
  invitationRoleLine,
} from "./invitation-helpers"

/**
 * Invitation cards with «Принять» / «Отклонить». Shared by the Invitations
 * screen, the Profile section and the no-club onboarding screen. Accepting
 * makes the club the active one; `onAccepted` lets the host move on from there.
 */
export function InvitationList({
  invitations,
  onChanged,
  onAccepted,
}: {
  invitations: Invitation[]
  onChanged: () => void | Promise<void>
  onAccepted?: (result: AcceptInvitationResult) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { refresh } = useAuth()
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const accept = async (inv: Invitation) => {
    if (busyId) return
    setBusyId(inv.id)
    try {
      const result = await acceptInvitation(inv.id)
      haptics.success()
      showToast(acceptedToast(result.workspaceName), "success")
      // So the club appears in the list and becomes the active one.
      await refresh({ activate: result.workspaceId })
      onAccepted?.(result)
      await onChanged()
    } catch (e) {
      showAlert(
        "Не удалось принять приглашение",
        errorMessage(e, "Попробуйте ещё раз."),
      )
    } finally {
      setBusyId(null)
    }
  }

  const decline = (inv: Invitation) => {
    if (busyId) return
    const { title, message } = declineConfirm(inv.workspaceName)
    showAlert(title, message, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Отклонить",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyId(inv.id)
            try {
              await declineInvitation(inv.id)
              showToast("Приглашение отклонено")
              await onChanged()
            } catch (e) {
              showAlert(
                "Не удалось отклонить приглашение",
                errorMessage(e, "Попробуйте ещё раз."),
              )
            } finally {
              setBusyId(null)
            }
          })()
        },
      },
    ])
  }

  return (
    <View style={styles.list}>
      {invitations.map((inv) => {
        const busy = busyId === inv.id
        const meta = invitationMeta(inv)
        return (
          <View key={inv.id} style={styles.card}>
            <View style={styles.headerRow}>
              <Text
                style={styles.icon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
              >
                {brandFromWorkspaceType(inv.workspaceType).emoji}
              </Text>
              <View style={styles.headerText}>
                <Text style={styles.club} numberOfLines={2}>
                  {inv.workspaceName}
                </Text>
                <Text style={styles.role}>{invitationRoleLine(inv)}</Text>
                {meta !== "" && <Text style={styles.meta}>{meta}</Text>}
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() => decline(inv)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Отклонить приглашение клуба ${inv.workspaceName}`}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.pressed,
                  busyId !== null && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryText}>Отклонить</Text>
              </Pressable>
              <Pressable
                onPress={() => void accept(inv)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Принять приглашение клуба ${inv.workspaceName}`}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.pressed,
                  busyId !== null && !busy && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.primaryText}>Принять</Text>
                )}
              </Pressable>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.spacing(3) },
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      gap: theme.spacing(4),
      ...theme.shadows.sm,
    },
    headerRow: { flexDirection: "row", gap: theme.spacing(3) },
    icon: { fontSize: 28 },
    headerText: { flex: 1, gap: 2 },
    club: { ...theme.typography.subheading, color: theme.colors.text },
    role: { ...theme.typography.body, color: theme.colors.textSecondary },
    meta: { fontSize: 13, color: theme.colors.muted },
    actions: { flexDirection: "row", gap: theme.spacing(2) },
    primaryBtn: {
      flex: 1,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingVertical: theme.spacing(3),
      alignItems: "center",
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    secondaryBtn: {
      flex: 1,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing(3),
      alignItems: "center",
    },
    secondaryText: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
  })
