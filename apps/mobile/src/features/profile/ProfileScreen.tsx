import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import Constants from "expo-constants"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { MEMBER_SECTIONS, visibleSections } from "../../app/nav-sections"
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
import { brand } from "../../shared/brand"
import { environment } from "../../shared/env"
import { formatRoleName } from "../../shared/role-labels"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"
import { formatLevelWithStripes, stripeColorOn } from "../ranks/rank-format"

type Props = NativeStackScreenProps<RootStackParamList, "Profile">

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

export function ProfileScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, workspaces, switchWorkspace, signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

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
  const { data: ranks, error: ranksError } = useCachedResource<MyRanks>(
    ranksFeatureOn && workspace ? `ranks:${workspace.workspaceId}` : null,
    useCallback(
      async () => await getMyRanks({ workspaceId: workspace!.workspaceId }),
      [workspace],
    ),
  )
  // `error` is set only when there's nothing cached to show (offline first
  // open, expired access → 403). Drop the card then rather than leave a header
  // that reads "загружается" forever.
  const showRanks = ranksFeatureOn && !ranksError
  const rankSummary = !ranks
    ? "загружается"
    : ranks.current.length
      ? ranks.current
          .map(
            (p) =>
              `${p.ladderName}: ${formatLevelWithStripes(p.levelName, p.stripes)}`,
          )
          .join(", ")
      : "не присвоен"

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
    ? [me.firstname, me.lastname].filter(Boolean).join(" ") || "Не указано"
    : ""

  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—"

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

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Профиль</Text>

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
            <Field label="Email" value={me.email} mono />
            <Field label="Имя" value={fullName} />
            <Field label="Клуб" value={workspace?.name ?? "—"} />
            {membership?.role && (
              <Field label="Роль" value={formatRoleName(membership.role)} />
            )}
            {membership?.accessUntil && (
              <Field
                label="Доступ до"
                value={formatDate(membership.accessUntil)}
              />
            )}
            <Field label="С нами с" value={formatDate(me.createdAt)} />
          </View>
        )}

        {showRanks && (
          <Pressable
            onPress={() => navigation.navigate("MyRanks")}
            accessibilityRole="button"
            accessibilityLabel={`Ранг: ${rankSummary}`}
            accessibilityHint="Открыть историю повышений"
            style={styles.card}
          >
            <View style={styles.rankHeader}>
              <Text style={styles.fieldLabel}>Ранг</Text>
              <Chevron style={styles.actionChev} />
            </View>
            {ranks?.current.map((p) => <RankRow key={p.id} promotion={p} />)}
            {ranks && ranks.current.length === 0 && (
              <Text style={styles.rankHint}>
                Пока не присвоен. Ранг отмечает тренер.
              </Text>
            )}
          </Pressable>
        )}

        {workspaces.length > 1 && (
          <View style={styles.actionsBlock}>
            {workspaces.map((w) => {
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
                  style={styles.actionRow}
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
        )}

        <View style={styles.actionsBlock}>
          {visibleSections(
            MEMBER_SECTIONS,
            (key) => isFeatureEnabled(workspace, key),
            supportsOfflineDownload,
          ).map((section) => (
            <Pressable
              key={section.route}
              onPress={() => navigation.navigate(section.route)}
              style={styles.actionRow}
            >
              <Text style={styles.actionLabel}>{section.label}</Text>
              {section.route === "Notifications" && unreadCount > 0 ? (
                <View style={styles.actionRight}>
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Text>
                  </View>
                  <Chevron style={styles.actionChev} />
                </View>
              ) : (
                <Chevron style={styles.actionChev} />
              )}
            </Pressable>
          ))}
        </View>

        <View style={styles.linksBlock}>
          <Pressable
            onPress={() => void Linking.openURL(brand.legal.privacyUrl)}
            accessibilityRole="link"
            accessibilityLabel="Политика конфиденциальности"
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Политика конфиденциальности</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(brand.legal.termsUrl)}
            accessibilityRole="link"
            accessibilityLabel="Условия использования"
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Условия использования</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void Linking.openURL(`mailto:${brand.legal.supportEmail}`)
            }
            accessibilityRole="link"
            accessibilityLabel="Поддержка"
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Поддержка</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Выйти из аккаунта"
          style={styles.signOutButton}
        >
          <Text style={styles.signOutText}>Выйти</Text>
        </Pressable>

        <Text style={styles.muted}>
          {brand.displayName} · версия {appVersion}
        </Text>
        <Text style={styles.mutedSmall}>
          API: {environment.apiBaseUrl.replace(/^https?:\/\//, "")}
        </Text>
      </ScrollView>
      </CenteredColumn>
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
        <Text style={styles.fieldLabel}>{promotion.ladderName}</Text>
        <Text style={styles.fieldValue}>
          {formatLevelWithStripes(promotion.levelName, promotion.stripes)}
        </Text>
      </View>
    </View>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(4),
  },
  title: {
    ...theme.typography.title,
    fontSize: 28,
    color: theme.colors.text,
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
  rankHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  rankSwatch: {
    width: 64,
    height: 36,
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
    height: 18,
    borderRadius: 1,
  },
  rankHint: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  field: { gap: 4 },
  fieldLabel: { ...theme.typography.label },
  fieldValue: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.text,
  },
  mono: { fontFamily: "monospace" },
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
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  actionLabel: {
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
  actionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
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
  linksBlock: { gap: 0 },
  linkRow: {
    paddingVertical: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  linkText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  signOutButton: {
    paddingVertical: theme.spacing(4),
    alignItems: "center",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.dangerSoft,
  },
  signOutText: { color: theme.colors.danger, fontSize: 15, fontWeight: "700" },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  muted: {
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: theme.spacing(2),
  },
  mutedSmall: {
    textAlign: "center",
    color: theme.colors.mutedFaint,
    fontSize: 10,
  },
})
