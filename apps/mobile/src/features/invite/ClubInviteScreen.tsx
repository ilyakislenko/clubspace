import React, { useCallback, useEffect, useState } from "react"
import { Image, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getWorkspaceInvite } from "../../shared/api/invite"
import {
  approvePendingMember,
  listPendingUsers,
  rejectPendingMember,
  type PendingUser,
} from "../../shared/api/pending"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { SplitLayout } from "../../shared/components/SplitLayout"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { shareFeedback, shareText } from "../../shared/share"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { fmtDate } from "../subscription/subscription-state"
import { canDecideRequests, canSeeClubInvite } from "./invite-access"
import { inviteShareMessage } from "./invite-share"

type Props = {
  route: { params?: { workspaceId?: string } }
}

const displayName = (u: PendingUser): string =>
  [u.firstname, u.lastname].filter(Boolean).join(" ").trim() || u.email

export function ClubInviteScreen({ route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, workspaces, switchWorkspace } = useAuth()
  const { sizeClass } = useResponsive()
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  // A push for another club opens this screen on that club.
  const targetId = route.params?.workspaceId
  useEffect(() => {
    if (
      targetId &&
      targetId !== workspace?.workspaceId &&
      workspaces.some((w) => w.workspaceId === targetId)
    ) {
      switchWorkspace(targetId)
    }
  }, [targetId, workspace?.workspaceId, workspaces, switchWorkspace])

  const workspaceId = workspace?.workspaceId
  const allowed = canSeeClubInvite(workspace)
  const canDecide = canDecideRequests(workspace)

  const invite = useCachedResource(
    workspaceId && allowed ? `invite:${workspaceId}` : null,
    useCallback(
      async () => await getWorkspaceInvite({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Under the `members` resource, so a join request or a decision made
  // elsewhere refreshes this list through the realtime invalidation.
  const pending = useCachedResource(
    workspaceId && allowed ? `members:${workspaceId}:pending` : null,
    useCallback(
      async () => await listPendingUsers({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )

  if (!workspace) return null

  if (!allowed) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <Text style={styles.empty}>Этот раздел — для тренеров клуба.</Text>
      </SafeAreaView>
    )
  }

  const data = invite.data
  const requests = pending.data?.data ?? []
  const qrSize = sizeClass === "compact" ? 220 : 280

  const refetch = () => {
    invite.refetch()
    pending.refetch()
  }

  const handleShare = async () => {
    if (!data?.joinUrl) return
    const feedback = shareFeedback(
      await shareText({
        title: data.workspaceName,
        message: inviteShareMessage({
          workspaceName: data.workspaceName,
          joinUrl: data.joinUrl,
          joinCodeDisplay: data.joinCodeDisplay,
        }),
      }),
    )
    if (feedback) showToast(feedback)
  }

  const removeRow = (userId: string) =>
    pending.mutate((prev) =>
      prev
        ? {
            data: prev.data.filter((u) => u.userId !== userId),
            total: Math.max(0, prev.total - 1),
          }
        : prev,
    )

  const approve = async (user: PendingUser) => {
    setBusyId(user.userId)
    try {
      await approvePendingMember({
        workspaceId: workspace.workspaceId,
        email: user.email,
      })
      removeRow(user.userId)
      showToast("Заявка принята", "success")
    } catch (err) {
      showToast(errorMessage(err, "Не удалось принять заявку"), "error")
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (user: PendingUser) => {
    setBusyId(user.userId)
    try {
      await rejectPendingMember({
        workspaceId: workspace.workspaceId,
        userId: user.userId,
      })
      removeRow(user.userId)
      showToast("Заявка отклонена")
    } catch (err) {
      showToast(errorMessage(err, "Не удалось отклонить заявку"), "error")
    } finally {
      setBusyId(null)
    }
  }

  const confirmReject = (user: PendingUser) =>
    showAlert("Отклонить заявку?", user.email, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Отклонить",
        style: "destructive",
        onPress: () => void reject(user),
      },
    ])

  const inviteCard = (
    <View style={styles.card}>
      {invite.error && !data ? (
        <ErrorRetry message={invite.error} onRetry={invite.refetch} />
      ) : data ? (
        <>
          <Text style={styles.cardLabel}>Код клуба</Text>
          <Text style={styles.code} selectable>
            {data.joinCodeDisplay}
          </Text>
          {data.qrPngDataUrl && (
            <Image
              source={{ uri: data.qrPngDataUrl }}
              style={{ width: qrSize, height: qrSize, alignSelf: "center" }}
              accessibilityLabel="QR-код для вступления в клуб"
            />
          )}
          {data.publicUrlNotice && (
            <Text style={styles.caption}>{data.publicUrlNotice}</Text>
          )}
          {data.joinUrl && (
            <Pressable
              onPress={handleShare}
              accessibilityRole="button"
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Поделиться приглашением</Text>
            </Pressable>
          )}
          <Text style={styles.caption}>
            {data.joinAutoApprove
              ? "Ученик открывает ссылку или наводит камеру на QR-код и входит по e-mail — и сразу попадает в клуб."
              : "Ученик открывает ссылку или наводит камеру на QR-код и входит по e-mail — заявка придёт вам."}
          </Text>
        </>
      ) : null}
    </View>
  )

  const requestsBlock = (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Заявки ({requests.length})</Text>
      {pending.error && !pending.data ? (
        <ErrorRetry message={pending.error} onRetry={pending.refetch} />
      ) : pending.data && requests.length === 0 ? (
        <Text style={styles.empty}>Новых заявок нет</Text>
      ) : (
        requests.map((u) => (
          <View key={u.userId} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>
                {displayName(u)}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {fmtDate(u.createdAt)}
              </Text>
            </View>
            {canDecide && (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => confirmReject(u)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  style={[styles.secondary, busyId !== null && styles.disabled]}
                >
                  <Text style={styles.secondaryText}>Отклонить</Text>
                </Pressable>
                <Pressable
                  onPress={() => void approve(u)}
                  disabled={busyId !== null}
                  accessibilityRole="button"
                  style={[styles.accept, busyId !== null && styles.disabled]}
                >
                  <Text style={styles.primaryText}>Принять</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))
      )}
      {!canDecide && requests.length > 0 && (
        <Text style={styles.caption}>
          Принять заявку может администратор клуба
        </Text>
      )}
    </View>
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={invite.refreshing || pending.refreshing}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {(invite.stale || pending.stale) && <OfflineNotice />}
          <SplitLayout side={inviteCard} main={requestsBlock} stackSideFirst />
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    cardLabel: { ...theme.typography.label, textAlign: "center" },
    code: {
      fontSize: 32,
      fontWeight: "700",
      color: theme.colors.text,
      textAlign: "center",
      letterSpacing: 2,
    },
    caption: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.text },
    empty: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
      padding: theme.spacing(3),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingTop: theme.spacing(3),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    rowText: { flex: 1, gap: 2 },
    rowName: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    rowMeta: { fontSize: 13, color: theme.colors.muted },
    actions: { flexDirection: "row", gap: theme.spacing(2) },
    primary: {
      alignItems: "center",
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    accept: {
      alignItems: "center",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    primaryText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.accentText,
    },
    secondary: {
      alignItems: "center",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
    },
    secondaryText: { fontSize: 14, fontWeight: "600", color: theme.colors.danger },
    disabled: { opacity: 0.5 },
  })
