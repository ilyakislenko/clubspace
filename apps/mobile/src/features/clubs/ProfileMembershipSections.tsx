import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import { listMyJoinRequests, type JoinRequest } from "../../shared/api/join"
import { setWorkspaceNotificationsMuted } from "../../shared/api/my-memberships"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { Switch } from "../../shared/components/Switch"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { InvitationList } from "../invitations/InvitationList"
import { useMyInvitations } from "../invitations/useMyInvitations"
import { myJoinRequestRows } from "../join/my-join-requests"
import { muteToast } from "./club-settings-helpers"

/**
 * Profile: pending invitations and my join requests, each only when there is
 * something in it. The signed-in person's club settings live on the club's row
 * in «Клубы» (the gear). In a child's profile there is one row here: the
 * child's club mute (one switch shared by its guardians;
 * docs/design/2026-11-26-parent-pays-for-child.md §5); leaving the club and
 * invitations stay the signed-in guardian's.
 */
export function ProfileMembershipSections() {
  const styles = useThemedStyles(makeStyles)
  const { workspace, actingAs, refresh } = useAuth()
  const { showToast } = useToast()
  // The switch follows the tap at once; the club list catches up on refresh.
  const [pendingOn, setPendingOn] = useState<boolean | null>(null)
  const { invitations, reload: reloadInvitations } = useMyInvitations()
  const [requests, setRequests] = useState<JoinRequest[]>([])

  // A failed load keeps the last list: the section is informational.
  const loadRequests = useCallback(async () => {
    try {
      setRequests((await listMyJoinRequests()).data)
    } catch {
      /* keep what we had */
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadRequests()
    }, [loadRequests]),
  )

  const rows = myJoinRequestRows(requests, brand.workspaceKey)

  const toggleChildNotifications = async (on: boolean) => {
    if (!workspace || pendingOn !== null) return
    setPendingOn(on)
    try {
      const res = await setWorkspaceNotificationsMuted(workspace.workspaceId, !on)
      showToast(muteToast(res.notificationsMuted))
      // The child's notificationsMuted comes back with its club list.
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

  return (
    <>
      {workspace && actingAs && (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Текущий клуб</Text>
          <View style={styles.block}>
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowLabel}>
                {`Уведомления клуба: ${actingAs.firstname}`}
              </Text>
              <Switch
                accessibilityLabel={`Уведомления клуба ${workspace.name}: ${actingAs.firstname}`}
                value={pendingOn ?? !workspace.notificationsMuted}
                disabled={pendingOn !== null}
                onValueChange={(v) => void toggleChildNotifications(v)}
              />
            </View>
          </View>
        </View>
      )}
      {invitations && invitations.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Приглашения</Text>
          <InvitationList
            invitations={invitations}
            onChanged={reloadInvitations}
          />
        </View>
      )}

      {rows.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Мои заявки</Text>
          <View style={styles.block}>
            {rows.map((r, i) => (
              <View
                key={r.workspaceId}
                style={[styles.row, i === rows.length - 1 && styles.rowLast]}
              >
                <Text style={styles.rowLabel} numberOfLines={2}>
                  {r.workspaceName}
                </Text>
                <Text
                  style={[
                    styles.status,
                    r.status === "rejected" && styles.statusRejected,
                  ]}
                >
                  {r.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    group: { gap: theme.spacing(2) },
    groupTitle: {
      ...theme.typography.label,
      paddingHorizontal: theme.spacing(1),
    },
    block: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
      ...theme.shadows.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(4),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: "500",
      color: theme.colors.text,
    },
    status: { fontSize: 13, fontWeight: "600", color: theme.colors.accent },
    statusRejected: { color: theme.colors.danger },
  })
