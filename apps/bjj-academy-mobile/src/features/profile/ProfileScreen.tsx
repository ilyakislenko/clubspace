import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import Constants from "expo-constants"
import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Modal,
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
import {
  BELT_INFO,
  BELT_OPTIONS,
  formatBeltWithStripes,
} from "./belt"
import {
  getPreferences,
  setPreferences,
  type BeltRank,
} from "./preferences-store"

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
  const [belt, setBelt] = useState<BeltRank | null>(null)
  const [stripes, setStripes] = useState(0)
  const [beltPickerOpen, setBeltPickerOpen] = useState(false)
  const [stripesPickerOpen, setStripesPickerOpen] = useState(false)

  const showBelt = brand.key === "grappling"

  useEffect(() => {
    if (!showBelt) return
    void getPreferences().then((p) => {
      setBelt(p.belt)
      setStripes(p.beltStripes)
    })
  }, [showBelt])

  const persistBelt = async (next: BeltRank | null, nextStripes: number) => {
    setBelt(next)
    setStripes(nextStripes)
    await setPreferences({ belt: next, beltStripes: nextStripes })
  }

  const handlePickBelt = () => setBeltPickerOpen(true)
  const handlePickStripes = () => {
    if (!belt) return
    setStripesPickerOpen(true)
  }

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

        {showBelt && (
          <View style={styles.card}>
            <Text style={styles.beltSectionTitle}>Спортивный разряд</Text>
            <Pressable onPress={handlePickBelt} style={styles.beltRow}>
              <View
                style={[
                  styles.beltSwatch,
                  belt
                    ? {
                        backgroundColor: BELT_INFO[belt].color,
                        borderColor: BELT_INFO[belt].color,
                      }
                    : styles.beltSwatchEmpty,
                ]}
              >
                <View style={styles.beltStripes}>
                  {Array.from({ length: stripes }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.beltStripe,
                        belt && {
                          backgroundColor: BELT_INFO[belt].textColor,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Пояс</Text>
                <Text style={styles.fieldValue}>
                  {belt ? formatBeltWithStripes(belt, stripes) : "Не указан"}
                </Text>
              </View>
              <Text style={styles.actionChev}>›</Text>
            </Pressable>
            {belt && (
              <Pressable onPress={handlePickStripes} style={styles.beltStripesRow}>
                <Text style={styles.fieldLabel}>Полоски</Text>
                <Text style={styles.beltStripesValue}>{stripes}</Text>
              </Pressable>
            )}
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
            onPress={() => navigation.navigate("MyGroups")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Мои группы</Text>
            <Text style={styles.actionChev}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Gyms")}
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Залы клуба</Text>
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

      <Modal
        visible={beltPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setBeltPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setBeltPickerOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Какой у вас пояс?</Text>
            <ScrollView style={styles.modalList}>
              {BELT_OPTIONS.map((option) => {
                const active = belt === option.rank
                return (
                  <Pressable
                    key={option.rank}
                    onPress={() => {
                      setBeltPickerOpen(false)
                      void persistBelt(option.rank, stripes)
                    }}
                    style={({ pressed }) => [
                      styles.modalRow,
                      pressed && styles.modalRowPressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.modalSwatch,
                        {
                          backgroundColor: option.color,
                          borderColor: option.color,
                        },
                      ]}
                    />
                    <Text style={styles.modalRowLabel}>{option.label}</Text>
                    {active && <Text style={styles.modalCheck}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
            {belt && (
              <Pressable
                onPress={() => {
                  setBeltPickerOpen(false)
                  void persistBelt(null, 0)
                }}
                style={({ pressed }) => [
                  styles.modalRow,
                  styles.modalDestructive,
                  pressed && styles.modalRowPressed,
                ]}
              >
                <Text style={styles.modalDestructiveText}>Сбросить</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setBeltPickerOpen(false)}
              style={({ pressed }) => [
                styles.modalRow,
                styles.modalCancel,
                pressed && styles.modalRowPressed,
              ]}
            >
              <Text style={styles.modalCancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={stripesPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setStripesPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setStripesPickerOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Сколько полосок?</Text>
            {[0, 1, 2, 3, 4].map((n) => {
              const active = stripes === n
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setStripesPickerOpen(false)
                    if (belt) void persistBelt(belt, n)
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && styles.modalRowPressed,
                  ]}
                >
                  <Text style={styles.modalRowLabel}>{n}</Text>
                  {active && <Text style={styles.modalCheck}>✓</Text>}
                </Pressable>
              )
            })}
            <Pressable
              onPress={() => setStripesPickerOpen(false)}
              style={({ pressed }) => [
                styles.modalRow,
                styles.modalCancel,
                pressed && styles.modalRowPressed,
              ]}
            >
              <Text style={styles.modalCancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  beltSectionTitle: {
    ...theme.typography.label,
    marginBottom: theme.spacing(1),
  },
  beltRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  beltSwatch: {
    width: 64,
    height: 36,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  beltSwatchEmpty: {
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  beltStripes: {
    flexDirection: "row",
    gap: 3,
  },
  beltStripe: {
    width: 4,
    height: 18,
    borderRadius: 1,
    backgroundColor: theme.colors.text,
  },
  beltStripesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: theme.spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  beltStripesValue: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing(2),
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(6),
    gap: theme.spacing(1),
    maxHeight: "80%",
  },
  modalTitle: {
    ...theme.typography.label,
    paddingHorizontal: theme.spacing(3),
    paddingBottom: theme.spacing(2),
  },
  modalList: {
    flexGrow: 0,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
  },
  modalRowPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  modalSwatch: {
    width: 28,
    height: 18,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
  },
  modalRowLabel: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    fontWeight: "500",
  },
  modalCheck: {
    fontSize: 16,
    color: theme.colors.accent,
    fontWeight: "800",
  },
  modalDestructive: {
    marginTop: theme.spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing(3),
  },
  modalDestructiveText: {
    fontSize: 15,
    color: theme.colors.danger,
    fontWeight: "600",
  },
  modalCancel: {
    marginTop: theme.spacing(1),
    backgroundColor: theme.colors.surfaceMuted,
  },
  modalCancelText: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: "700",
    textAlign: "center",
    flex: 1,
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
