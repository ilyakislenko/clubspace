import Ionicons from "@expo/vector-icons/Ionicons"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { PROFILE_SECTIONS, visibleSections } from "../../app/nav-sections"
import { NavRowList } from "../../app/NavRowList"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"

import { fetchMe, type Me } from "../../shared/api/me"
import {
  fetchMyMembership,
  type WorkspaceMembership,
} from "../../shared/api/memberships"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { supportsOfflineDownload } from "../../shared/platform"
import { formatRoleName } from "../../shared/role-labels"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { TabScreenProps } from "../../app/navigation"
import { accessStatus, fmtDate } from "../subscription/subscription-state"
import { EditNameModal } from "./EditNameModal"

type Props = TabScreenProps<"Profile">

const initialsOf = (me: Me): string => {
  const names = [me.firstname, me.lastname].filter(
    (n): n is string => Boolean(n?.trim()),
  )
  const source = names.length > 0 ? names : [me.email]
  return (
    source
      .slice(0, 2)
      .map((part) => part.trim()[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

export function ProfileScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, workspaces, switchWorkspace } = useAuth()
  const [editingName, setEditingName] = useState(false)

  // Same keys as Home, so a name saved on either shows on both, and the tab
  // (which stays mounted) revalidates whenever it is focused.
  const workspaceId = workspace?.workspaceId
  const meRes = useCachedResource<Me>(
    workspaceId ? `me:${workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  const membershipRes = useCachedResource<WorkspaceMembership>(
    workspaceId ? `membership:${workspaceId}` : null,
    useCallback(
      async () => await fetchMyMembership({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const me = meRes.data
  const membership = membershipRes.data
  const loading = meRes.loading && !me
  const error = meRes.error

  const fullName = me
    ? [me.firstname, me.lastname].filter(Boolean).join(" ").trim()
    : ""

  // A member's role is the default and says nothing; staff roles are worth
  // showing (and the owner, who has no member row, reads as "Владелец").
  const roleLabel = membership?.isOwner
    ? "Владелец"
    : membership?.role && membership.role !== "user"
      ? formatRoleName(membership.role)
      : null

  const access = accessStatus(membership?.accessUntil)

  const sections = visibleSections(
    PROFILE_SECTIONS,
    (key) => isFeatureEnabled(workspace, key),
    supportsOfflineDownload,
  )

  return (
    <View style={styles.root}>
      <CenteredColumn>
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : error || !me ? (
          <ErrorRetry
            message={error ?? "Профиль не найден."}
            onRetry={meRes.refetch}
          />
        ) : (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(me)}</Text>
              </View>
              <Pressable
                onPress={() => setEditingName(true)}
                accessibilityRole="button"
                accessibilityLabel={`${fullName || "Имя не указано"}, ${me.email}`}
                accessibilityHint={fullName ? "Изменить имя" : "Добавить имя"}
                style={styles.headerText}
              >
                <View style={styles.nameRow}>
                  <Text
                    style={[styles.name, !fullName && styles.nameMissing]}
                    numberOfLines={1}
                  >
                    {fullName || "Добавить имя"}
                  </Text>
                  <Ionicons
                    name={fullName ? "create-outline" : "add-circle-outline"}
                    size={18}
                    color={fullName ? theme.colors.mutedFaint : theme.colors.accent}
                  />
                </View>
                <Text style={styles.email} numberOfLines={1}>
                  {me.email}
                </Text>
              </Pressable>
              {roleLabel && (
                <View style={styles.rolePill}>
                  <Text style={styles.rolePillText}>{roleLabel}</Text>
                </View>
              )}
            </View>

            <Text style={styles.meta}>
              {[
                workspace?.name,
                `с нами с ${fmtDate(me.createdAt)}`,
                access?.variant === "ok" && membership?.accessUntil
                  ? `доступ до ${fmtDate(membership.accessUntil)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        )}

        {workspaces.length > 1 && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Клубы</Text>
            <View style={styles.actionsBlock}>
              {workspaces.map((w, i) => {
                const active = w.workspaceId === workspace?.workspaceId
                return (
                  <Pressable
                    key={w.workspaceId}
                    onPress={() => switchWorkspace(w.workspaceId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Клуб ${w.name}${
                      active ? ", активный" : ", переключиться"
                    }`}
                    accessibilityState={{ selected: active, disabled: active }}
                    style={[
                      styles.actionRow,
                      i === workspaces.length - 1 && styles.actionRowLast,
                    ]}
                    disabled={active}
                  >
                    <Text
                      style={[
                        styles.actionLabel,
                        active && styles.activeWorkspaceLabel,
                      ]}
                    >
                      {w.name}
                    </Text>
                    {active ? (
                      <Text style={styles.activeMarker}>активный</Text>
                    ) : (
                      <Chevron style={styles.actionChev} />
                    )}
                  </Pressable>
                )
              })}
            </View>
          </View>
        )}

        <NavRowList
          sections={sections}
          onPress={(route) => navigation.navigate(route)}
        />
      </ScrollView>
      </CenteredColumn>

      {editingName && me && (
        <EditNameModal
          me={me}
          onClose={() => setEditingName(false)}
          onSaved={(updated) => {
            meRes.mutate(updated)
            setEditingName(false)
          }}
        />
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(5),
  },
  card: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
    ...theme.shadows.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: theme.colors.accent,
    fontSize: 20,
    fontWeight: "800",
  },
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
  name: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text,
  },
  nameMissing: { color: theme.colors.accent, fontWeight: "600" },
  email: { fontSize: 14, color: theme.colors.muted },
  rolePill: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accentSoft,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.accent,
  },
  meta: { fontSize: 13, color: theme.colors.textSecondary, lineHeight: 18 },
  group: { gap: theme.spacing(2) },
  groupTitle: {
    ...theme.typography.label,
    paddingHorizontal: theme.spacing(1),
  },
  actionsBlock: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    ...theme.shadows.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  actionRowLast: { borderBottomWidth: 0 },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.text,
  },
  activeWorkspaceLabel: { fontWeight: "700", color: theme.colors.accent },
  activeMarker: {
    fontSize: 11,
    color: theme.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: "700",
  },
  actionChev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
})
