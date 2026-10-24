import Ionicons from "@expo/vector-icons/Ionicons"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  MEMBER_SECTIONS,
  NAV_GROUP_LABELS,
  type NavGroup,
  visibleSections,
} from "../../app/nav-sections"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import { listNotifications } from "../../shared/api/notifications"
import {
  fetchMyMembership,
  type WorkspaceMembership,
} from "../../shared/api/memberships"
import {
  getMyRanks,
  type MyRanks,
  type Promotion,
} from "../../shared/api/ranks"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { errorMessage } from "../../shared/error-message"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { supportsOfflineDownload } from "../../shared/platform"
import { formatRoleName } from "../../shared/role-labels"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"
import { formatLevelWithStripes, stripeColorOn } from "../ranks/rank-format"
import { EditNameModal } from "./EditNameModal"

type Props = NativeStackScreenProps<RootStackParamList, "Profile">

// Sections render under these headings, in this order. "Отметиться" is pulled
// out of the list into the primary button — it's the one thing a member does
// at the gym, not a menu item.
const GROUP_ORDER: readonly NavGroup[] = ["training", "club", "progress", "account"]

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

const daysUntil = (iso: string): number => {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

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
  const [me, setMe] = useState<Me | null>(null)
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [editingName, setEditingName] = useState(false)

  // Refresh the unread badge on mount and whenever we return to Profile (e.g.
  // after the inbox marked everything seen).
  useEffect(() => {
    const load = () => {
      void listNotifications({ perPage: 50 })
        .then((page) =>
          setUnreadCount(page.data.filter((n) => !n.seen).length),
        )
        .catch(() => undefined)
    }
    load()
    return navigation.addListener("focus", load)
  }, [navigation])

  // Ranks are awarded by a coach in the admin; the member only sees them.
  // Same cache key as MyRanksScreen, so either screen paints the other's data.
  const ranksFeatureOn = isFeatureEnabled(workspace, "ranks")
  const { data: ranks } = useCachedResource<MyRanks>(
    ranksFeatureOn && workspace ? `ranks:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyRanks({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  // Only once there IS a rank: an empty "not assigned yet" block was noise,
  // and its arrow led to an empty history.
  const currentRanks = ranksFeatureOn ? (ranks?.current ?? []) : []
  const rankSummary = currentRanks
    .map(
      (p) => `${p.ladderName}: ${formatLevelWithStripes(p.levelName, p.stripes)}`,
    )
    .join(", ")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [profile, mem] = await Promise.all([
          fetchMe(),
          workspace
            ? fetchMyMembership({ workspaceId: workspace.workspaceId }).catch(
                () => null,
              )
            : Promise.resolve(null),
        ])
        if (cancelled) return
        setMe(profile)
        setMembership(mem)
      } catch (err) {
        if (cancelled) return
        setError(
          errorMessage(err, "Не удалось загрузить профиль."),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspace])

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

  const accessDays = membership?.accessUntil
    ? daysUntil(membership.accessUntil)
    : null
  const accessVariant: "ok" | "warn" | "expired" | null =
    accessDays === null
      ? null
      : accessDays < 0
        ? "expired"
        : accessDays <= 14
          ? "warn"
          : "ok"

  const sections = visibleSections(
    MEMBER_SECTIONS,
    (key) => isFeatureEnabled(workspace, key),
    supportsOfflineDownload,
  )
  const checkIn = sections.find((s) => s.route === "CheckIn")
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: sections.filter((s) => s.group === group && s.route !== "CheckIn"),
  })).filter((g) => g.items.length > 0)

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <ScrollView contentContainerStyle={styles.body}>
        {accessVariant === "expired" && (
          <View style={[styles.banner, styles.bannerDanger]}>
            <Text style={styles.bannerTitle}>Доступ закончился</Text>
            <Text style={styles.bannerText}>
              Срок: {formatDate(membership!.accessUntil!)}. Свяжитесь с
              администратором клуба, чтобы продлить.
            </Text>
          </View>
        )}
        {accessVariant === "warn" && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>
              Доступ истекает через {accessDays} дн.
            </Text>
            <Text style={styles.bannerText}>
              До {formatDate(membership!.accessUntil!)}. Свяжитесь с
              администратором клуба заранее.
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : error || !me ? (
          <Text style={styles.errorText}>{error ?? "Профиль не найден."}</Text>
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
                `с нами с ${formatDate(me.createdAt)}`,
                accessVariant === "ok" && membership?.accessUntil
                  ? `доступ до ${formatDate(membership.accessUntil)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>

            {currentRanks.length > 0 && (
              <Pressable
                onPress={() => navigation.navigate("MyRanks")}
                accessibilityRole="button"
                accessibilityLabel={`Ранг: ${rankSummary}`}
                accessibilityHint="Открыть историю повышений"
                style={styles.rankBlock}
              >
                <View style={styles.rankRows}>
                  {currentRanks.map((p) => (
                    <RankRow key={p.id} promotion={p} />
                  ))}
                </View>
                <Chevron style={styles.actionChev} />
              </Pressable>
            )}
          </View>
        )}

        {checkIn && (
          <Pressable
            onPress={() => navigation.navigate("CheckIn")}
            accessibilityRole="button"
            style={styles.primaryCta}
          >
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={theme.colors.accentText}
            />
            <Text style={styles.primaryCtaText}>{checkIn.label}</Text>
          </Pressable>
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

        {groups.map(({ group, items }) => (
          <View key={group} style={styles.group}>
            <Text style={styles.groupTitle}>{NAV_GROUP_LABELS[group]}</Text>
            <View style={styles.actionsBlock}>
              {items.map((section, i) => (
                <Pressable
                  key={section.route}
                  onPress={() => navigation.navigate(section.route)}
                  style={[
                    styles.actionRow,
                    i === items.length - 1 && styles.actionRowLast,
                  ]}
                >
                  {section.icon && (
                    <Ionicons
                      name={section.icon}
                      size={20}
                      color={theme.colors.accent}
                      style={styles.actionIcon}
                    />
                  )}
                  <Text style={styles.actionLabel}>{section.label}</Text>
                  {section.route === "Notifications" && unreadCount > 0 && (
                    <View style={styles.actionBadge}>
                      <Text style={styles.actionBadgeText}>
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </Text>
                    </View>
                  )}
                  <Chevron style={styles.actionChev} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      </CenteredColumn>

      {editingName && me && (
        <EditNameModal
          me={me}
          onClose={() => setEditingName(false)}
          onSaved={(updated) => {
            setMe(updated)
            setEditingName(false)
          }}
        />
      )}
    </SafeAreaView>
  )
}

function RankRow({ promotion }: { promotion: Promotion }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const color = promotion.color ?? theme.colors.mutedFaint
  return (
    <View style={styles.rankRow}>
      <View
        style={[styles.rankSwatch, { backgroundColor: color, borderColor: color }]}
      >
        <View style={styles.rankStripes}>
          {Array.from({ length: promotion.stripes }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.rankStripe,
                { backgroundColor: stripeColorOn(color) },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rankLadder}>{promotion.ladderName}</Text>
        <Text style={styles.rankLevel}>
          {formatLevelWithStripes(promotion.levelName, promotion.stripes)}
        </Text>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    padding: theme.spacing(5),
    // Room under the last section for the floating drill-timer button.
    paddingBottom: theme.spacing(20),
    gap: theme.spacing(5),
  },
  banner: {
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    gap: theme.spacing(1),
  },
  bannerDanger: {
    backgroundColor: theme.colors.dangerSoft,
  },
  bannerWarn: {
    backgroundColor: theme.colors.warningSoft,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.text,
  },
  bannerText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 19,
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
  rankBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingTop: theme.spacing(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  rankRows: { flex: 1, gap: theme.spacing(2) },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  rankSwatch: {
    width: 56,
    height: 28,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rankStripes: {
    flexDirection: "row",
    gap: 3,
  },
  rankStripe: {
    width: 4,
    height: 14,
    borderRadius: 1,
  },
  rankLadder: { ...theme.typography.label },
  rankLevel: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.accent,
  },
  primaryCtaText: {
    color: theme.colors.accentText,
    fontSize: 16,
    fontWeight: "700",
  },
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
  actionIcon: { width: 22, textAlign: "center" },
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
  actionBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBadgeText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  errorText: { color: theme.colors.danger, fontSize: 14 },
})
