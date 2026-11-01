import Ionicons from "@expo/vector-icons/Ionicons"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  PROFILE_SECTIONS,
  sectionRoute,
  visibleSections,
} from "../../app/nav-sections"
import { NavRowList } from "../../app/NavRowList"
import { NavTileGrid } from "../../app/NavTileGrid"
import { AddClubRow, ClubRow } from "../clubs/ClubRow"
import { sortClubs } from "../clubs/club-switcher-helpers"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"

import { fetchMe, type Me } from "../../shared/api/me"
import {
  fetchMyMembership,
  type WorkspaceMembership,
} from "../../shared/api/memberships"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { SplitLayout } from "../../shared/components/SplitLayout"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { formatRoleName } from "../../shared/role-labels"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { useResponsive } from "../../shared/useResponsive"
import type { TabScreenProps } from "../../app/navigation"
import { ProfileSwitcher } from "../children/ProfileSwitcher"
import { pendingInvites } from "../children/children-helpers"
import { canSeeClubInvite } from "../invite/invite-access"
import { accessStatus, fmtDate } from "../subscription/subscription-state"
import { EditNameModal } from "./EditNameModal"
import { ProfileMembershipSections } from "../clubs/ProfileMembershipSections"

type Props = TabScreenProps<"Profile">

const initialsOf = (me: Me): string => {
  const names = [me.firstname, me.lastname].filter(
    (n): n is string => Boolean(n?.trim()),
  )
  const source = names.length > 0 ? names : me.email ? [me.email] : []
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
  const { workspace, workspaces, switchWorkspace, actingAs, dependents } =
    useAuth()
  const { sizeClass } = useResponsive()
  const [editingName, setEditingName] = useState(false)
  const offlineDownloads = useOfflineDownloadsAllowed()
  const invitesCount = pendingInvites(dependents).length

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
    offlineDownloads,
    // Inviting people is staff work, never a child profile's.
    !actingAs && canSeeClubInvite(workspace),
  )
  // A child's name is the guardian's to change, on «Дети» (PATCH /me would
  // edit the guardian's own name).
  const canEditName = !actingAs
  const subtitle = me?.email ?? (actingAs ? "Профиль ребёнка" : "")

  return (
    <View style={styles.root}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
      <ScrollView contentContainerStyle={styles.body}>
        <SplitLayout
          sidePosition="start"
          stackSideFirst
          side={
            <>
        <ProfileSwitcher />

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
                disabled={!canEditName}
                accessibilityRole={canEditName ? "button" : "text"}
                accessibilityLabel={`${fullName || "Имя не указано"}, ${subtitle}`}
                accessibilityHint={
                  canEditName
                    ? fullName
                      ? "Изменить имя"
                      : "Добавить имя"
                    : undefined
                }
                style={styles.headerText}
              >
                <View style={styles.nameRow}>
                  <Text
                    style={[styles.name, !fullName && styles.nameMissing]}
                    numberOfLines={1}
                  >
                    {fullName || (canEditName ? "Добавить имя" : "Без имени")}
                  </Text>
                  {canEditName && (
                    <Ionicons
                      name={fullName ? "create-outline" : "add-circle-outline"}
                      size={18}
                      color={
                        fullName ? theme.colors.mutedFaint : theme.colors.accent
                      }
                    />
                  )}
                </View>
                <Text style={styles.email} numberOfLines={1}>
                  {subtitle}
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

        {workspaces.length > 0 && (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Клубы</Text>
            <View style={styles.actionsBlock}>
              {sortClubs(workspaces).map((w) => {
                const active = w.workspaceId === workspace?.workspaceId
                return (
                  <ClubRow
                    key={w.workspaceId}
                    club={w}
                    current={active}
                    disabled={active}
                    onPress={() => switchWorkspace(w.workspaceId)}
                    // Mute / leave act on the signed-in guardian's own
                    // membership, never a child's.
                    onOpenSettings={
                      actingAs
                        ? undefined
                        : () =>
                            navigation.navigate("ClubSettings", {
                              workspaceId: w.workspaceId,
                            })
                    }
                  />
                )
              })}
              <AddClubRow
                onPress={() => navigation.navigate("JoinClub")}
                forChild={!!actingAs}
              />
            </View>
          </View>
        )}

        <View style={styles.group}>
          <Text style={styles.groupTitle}>Семья</Text>
          <View style={styles.actionsBlock}>
            <Pressable
              onPress={() => navigation.navigate("Children")}
              accessibilityRole="button"
              accessibilityLabel={
                invitesCount > 0
                  ? `Дети, приглашений от клубов: ${invitesCount}`
                  : "Дети"
              }
              accessibilityHint="Добавить ребёнка, подтвердить приглашение клуба или переключиться на профиль ребёнка"
              style={[styles.actionRow, styles.actionRowLast]}
            >
              <View style={[styles.addClubLabel, styles.fill]}>
                <Ionicons
                  name="people-outline"
                  size={20}
                  color={theme.colors.accent}
                />
                <Text style={styles.actionLabel}>Дети</Text>
              </View>
              {invitesCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{invitesCount}</Text>
                </View>
              )}
              <Chevron style={styles.actionChev} />
            </Pressable>
          </View>
        </View>

        <ProfileMembershipSections />
            </>
          }
          main={
            sizeClass === "compact" ? (
              <NavRowList
                sections={sections}
                onPress={(route) => navigation.navigate(sectionRoute(route))}
              />
            ) : (
              <NavTileGrid
                sections={sections}
                onPress={(route) => navigation.navigate(sectionRoute(route))}
                columns={{ medium: 3, expanded: 3 }}
              />
            )
          }
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
  addClubLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  actionChev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
  fill: { flex: 1 },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
  },
  badgeText: { color: theme.colors.accentText, fontSize: 12, fontWeight: "700" },
})
