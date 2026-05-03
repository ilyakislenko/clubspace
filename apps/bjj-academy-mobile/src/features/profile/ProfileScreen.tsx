import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import Constants from "expo-constants"
import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchMe, type Me } from "../../shared/api/me"
import {
  fetchMyMembership,
  type WorkspaceMembership,
} from "../../shared/api/memberships"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { environment } from "../../shared/env"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

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
  const { workspace, workspaces, switchWorkspace, signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          err instanceof Error ? err.message : "Не удалось загрузить профиль.",
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
              <Field label="Роль" value={membership.role} />
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

        {workspaces.length > 1 && (
          <View style={styles.actionsBlock}>
            {workspaces.map((w) => {
              const active = w.workspaceId === workspace?.workspaceId
              return (
                <Pressable
                  key={w.workspaceId}
                  onPress={() => switchWorkspace(w.workspaceId)}
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
                    <Text style={styles.actionChev}>›</Text>
                  )}
                </Pressable>
              )
            })}
          </View>
        )}

        <View style={styles.actionsBlock}>
          <Pressable
            onPress={() => navigation.navigate("OfflineLibrary")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Загруженные видео</Text>
            <Text style={styles.actionChev}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("ContinueWatching")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Продолжить просмотр</Text>
            <Text style={styles.actionChev}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Favorites")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Избранное</Text>
            <Text style={styles.actionChev}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Settings")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Настройки</Text>
            <Text style={styles.actionChev}>›</Text>
          </Pressable>
        </View>

        <View style={styles.linksBlock}>
          <Pressable
            onPress={() => void Linking.openURL(brand.legal.privacyUrl)}
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Политика конфиденциальности</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(brand.legal.termsUrl)}
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Условия использования</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void Linking.openURL(`mailto:${brand.legal.supportEmail}`)
            }
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Поддержка</Text>
          </Pressable>
        </View>

        <Pressable onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Выйти</Text>
        </Pressable>

        <Text style={styles.muted}>
          {brand.displayName} · версия {appVersion}
        </Text>
        <Text style={styles.mutedSmall}>
          API: {environment.apiBaseUrl.replace(/^https?:\/\//, "")}
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
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
