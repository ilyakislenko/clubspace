import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { listMyJoinRequests, type JoinRequest } from "../../shared/api/join"
import { brand } from "../../shared/brand"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { InvitationList } from "../invitations/InvitationList"
import { useMyInvitations } from "../invitations/useMyInvitations"
import { myJoinRequestRows } from "../join/my-join-requests"

/**
 * Profile: pending invitations and my join requests, each only when there is
 * something in it. The current club's settings live on its row in «Клубы» (the
 * gear).
 */
export function ProfileMembershipSections() {
  const styles = useThemedStyles(makeStyles)
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

  return (
    <>
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
