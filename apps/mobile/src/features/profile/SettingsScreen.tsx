import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import React, { useEffect, useState } from "react"
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native"
import { showAlert } from "../../shared/alert"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { CONTROL_MAX_WIDTH } from "../../shared/useResponsive"

import { THEME_KEYS, THEMES } from "@clubspace/ui-kit/util"

import { deleteAccount } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { isFeatureEnabled } from "../../shared/feature-flags"
import { brand } from "../../shared/brand"
import { useToast } from "../../shared/components/Toast"
import { Chevron } from "../../shared/components/Chevron"
import { environment } from "../../shared/env"
import { errorMessage } from "../../shared/error-message"
import {
  supportsOfflineDownload,
  supportsPushNotifications,
} from "../../shared/platform"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { buildColors } from "../../shared/themes"

import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "../../shared/api/notification-preferences"
import {
  clearAllOffline,
  getOfflineRootSizeBytes,
} from "../offline/offline-store"
import {
  getPreferences,
  setPreferences,
  type Preferences,
} from "./preferences-store"
import type { RootStackParamList } from "../../app/navigation"
import { registerPushToken } from "../notifications/push-registration"

// Design-system themes preview their *shape* in the swatch (round vs. square),
// hinting that switching changes the whole form language, not just the colour.
const SWATCH_RADIUS: Record<string, number> = {
  material: 13,
  ios: 10,
  carbon: 0,
  brutal: 2,
}

type Props = NativeStackScreenProps<RootStackParamList, "Settings">

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

export function SettingsScreen(_props: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { signOut, workspace } = useAuth()
  const { showToast } = useToast()
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [notif, setNotif] = useState<NotificationPreferences | null>(null)
  const [cacheSize, setCacheSize] = useState(0)
  // null until the OS answers, and always null where push doesn't exist (web).
  const [pushPermission, setPushPermission] =
    useState<Notifications.NotificationPermissionsStatus | null>(null)

  useEffect(() => {
    if (supportsPushNotifications) {
      void Notifications.getPermissionsAsync()
        .then(setPushPermission)
        .catch(() => undefined)
    }
    void getPreferences().then(setPrefs)
    void getOfflineRootSizeBytes().then(setCacheSize)
    // Notification toggles are server-authoritative (they gate real pushes),
    // so they live behind the API rather than in the local prefs file.
    void getNotificationPreferences()
      .then(setNotif)
      .catch(() => undefined)
  }, [])

  const update = async (patch: Partial<Preferences>) => {
    const next = await setPreferences(patch)
    setPrefs(next)
  }

  const updateNotif = async (patch: Partial<NotificationPreferences>) => {
    // Optimistic: flip the switch immediately, reconcile with the server
    // response, and re-fetch to revert if the write failed.
    setNotif((cur) => (cur ? { ...cur, ...patch } : cur))
    try {
      setNotif(await updateNotificationPreferences(patch))
    } catch (e) {
      showToast(errorMessage(e, "Не удалось сохранить настройку."), "error")
      void getNotificationPreferences()
        .then(setNotif)
        .catch(() => undefined)
    }
  }

  // After a denial the OS may still allow one more prompt (canAskAgain);
  // otherwise the only way back is the phone's own settings.
  const handleEnablePush = async () => {
    if (!pushPermission?.canAskAgain) {
      void Linking.openSettings()
      return
    }
    try {
      const next = await Notifications.requestPermissionsAsync()
      setPushPermission(next)
      if (next.granted) void registerPushToken()
    } catch {
      /* the prompt failed — the row stays so the member can retry */
    }
  }

  const handleDeleteAccount = () => {
    showAlert(
      "Удалить аккаунт?",
      "Это действие необратимо. Ваш профиль, доступы, заметки, закладки и загруженные на устройство видео будут удалены навсегда. Обезличенная история посещений и рангов сохранится в клубе.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccount()
              signOut({ wipeLocal: true })
            } catch (e) {
              showAlert("Не удалось удалить аккаунт", errorMessage(e))
            }
          },
        },
      ],
    )
  }

  const handleClearCache = () => {
    showAlert(
      "Очистить загруженные видео?",
      `Будет освобождено ~${formatBytes(cacheSize)}.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Очистить",
          style: "destructive",
          onPress: async () => {
            await clearAllOffline()
            const size = await getOfflineRootSizeBytes()
            setCacheSize(size)
          },
        },
      ],
    )
  }

  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—"

  if (!prefs) {
    return <SafeAreaView style={styles.root} />
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn>
      <ScrollView contentContainerStyle={styles.body}>

        <Section title="Оформление">
          <View style={styles.themeGrid}>
            {THEME_KEYS.map((key) => {
              const active = prefs.themeKey === key
              return (
                <Pressable
                  key={key}
                  onPress={() => update({ themeKey: key })}
                  style={styles.themeItem}
                  accessibilityRole="button"
                  accessibilityLabel={`Тема ${THEMES[key].name}`}
                >
                  <View
                    style={[
                      styles.swatch,
                      active && styles.swatchActive,
                      { backgroundColor: buildColors(key, "light").accent },
                      key in SWATCH_RADIUS
                        ? { borderRadius: SWATCH_RADIUS[key] }
                        : null,
                    ]}
                  >
                    {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
                  </View>
                  <Text style={styles.themeLabel}>{THEMES[key].name}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={styles.modeRow}>
            {(["light", "dark", "auto"] as const).map((m) => {
              const active = prefs.themeMode === m
              const label =
                m === "light" ? "Светлая" : m === "dark" ? "Тёмная" : "Авто"
              return (
                <Pressable
                  key={m}
                  onPress={() => update({ themeMode: m })}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Режим оформления: ${label}`}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      active && styles.modeBtnTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </Section>

        <Section title="Воспроизведение">
          <Row
            label="Автовоспроизведение"
            right={
              <Switch
                accessibilityLabel="Автовоспроизведение"
                value={prefs.autoplay}
                onValueChange={(v) => update({ autoplay: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
        </Section>

        <Section title="Уведомления">
          {pushPermission && !pushPermission.granted && (
            <LinkRow
              label="Уведомления выключены в настройках телефона"
              onPress={() => void handleEnablePush()}
            />
          )}
          <Row
            label="Новые видео"
            right={
              <Switch
                accessibilityLabel="Уведомления о новых видео"
                disabled={!notif}
                value={notif?.newVideosEnabled ?? true}
                onValueChange={(v) => updateNotif({ newVideosEnabled: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
          {isFeatureEnabled(workspace, "subscription") && (
            <Row
              label="Истечение доступа"
              right={
                <Switch
                  accessibilityLabel="Уведомления об истечении доступа"
                  disabled={!notif}
                  value={notif?.accessExpiringEnabled ?? true}
                  onValueChange={(v) =>
                    updateNotif({ accessExpiringEnabled: v })
                  }
                  trackColor={{
                    true: theme.colors.accent,
                    false: theme.colors.border,
                  }}
                />
              }
            />
          )}
          {isFeatureEnabled(workspace, "ranks") && (
            <Row
              label="Повышения ранга"
              right={
                <Switch
                  accessibilityLabel="Уведомления о повышении ранга"
                  disabled={!notif}
                  value={notif?.promotionsEnabled ?? true}
                  onValueChange={(v) => updateNotif({ promotionsEnabled: v })}
                  trackColor={{
                    true: theme.colors.accent,
                    false: theme.colors.border,
                  }}
                />
              }
            />
          )}
          {isFeatureEnabled(workspace, "announcements") && (
            <Row
              label="Анонсы клуба"
              right={
                <Switch
                  accessibilityLabel="Уведомления об анонсах клуба"
                  disabled={!notif}
                  value={notif?.announcementsEnabled ?? true}
                  onValueChange={(v) => updateNotif({ announcementsEnabled: v })}
                  trackColor={{
                    true: theme.colors.accent,
                    false: theme.colors.border,
                  }}
                />
              }
            />
          )}
          {isFeatureEnabled(workspace, "attendance") && (
            <Row
              label="Напоминания о пропусках"
              description="«Давно вас не было» — если вы перестали отмечаться на тренировках."
              right={
                <Switch
                  accessibilityLabel="Напоминания о пропусках тренировок"
                  disabled={!notif}
                  value={notif?.inactivityEnabled ?? true}
                  onValueChange={(v) => updateNotif({ inactivityEnabled: v })}
                  trackColor={{
                    true: theme.colors.accent,
                    false: theme.colors.border,
                  }}
                />
              }
            />
          )}
        </Section>

        {/* Offline downloads are native-only (expo-file-system), so on the web
            build this whole section is three controls that do nothing: a
            Wi-Fi-only toggle for downloads that can't happen, a size that is
            always 0 B, and a button that clears an empty store. */}
        {supportsOfflineDownload && (
        <Section title="Загрузки">
          <Row
            label="Только по Wi-Fi"
            right={
              <Switch
                accessibilityLabel="Загрузка только по Wi-Fi"
                value={prefs.wifiOnlyDownloads}
                onValueChange={(v) => update({ wifiOnlyDownloads: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
          <Row
            label="Загруженные видео"
            right={<Text style={styles.value}>{formatBytes(cacheSize)}</Text>}
          />
          <Pressable
            onPress={handleClearCache}
            accessibilityRole="button"
            accessibilityLabel="Очистить загруженное"
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>Очистить загруженное</Text>
          </Pressable>
        </Section>
        )}

        <Section title="О приложении">
          <Row
            label={brand.displayName}
            right={<Text style={styles.value}>версия {appVersion}</Text>}
          />
          <LinkRow
            label="Поддержка"
            onPress={() =>
              void Linking.openURL(`mailto:${brand.legal.supportEmail}`)
            }
          />
          <LinkRow
            label="Политика конфиденциальности"
            onPress={() => void Linking.openURL(brand.legal.privacyUrl)}
          />
          <LinkRow
            label="Условия использования"
            onPress={() => void Linking.openURL(brand.legal.termsUrl)}
          />
          <LinkRow
            label="Удаление аккаунта и данных"
            onPress={() => void Linking.openURL(brand.legal.deleteAccountUrl)}
          />
          {__DEV__ && (
            // Which backend a dev build talks to — useless to a member, so it
            // never ships in a release build.
            <Row
              label="API"
              right={
                <Text style={styles.value}>
                  {environment.apiBaseUrl.replace(/^https?:\/\//, "")}
                </Text>
              }
            />
          )}
        </Section>

        <Section title="Аккаунт">
          <Pressable
            onPress={() => signOut({ wipeLocal: true })}
            accessibilityRole="button"
            accessibilityLabel="Выйти из аккаунта"
            style={styles.row}
          >
            <Text style={styles.rowLabel}>Выйти</Text>
          </Pressable>
          <Pressable
            onPress={handleDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Удалить аккаунт"
            style={[styles.row, styles.rowLast]}
          >
            <Text style={styles.dangerRowLabel}>Удалить аккаунт</Text>
          </Pressable>
        </Section>
        <Text style={styles.deleteHint}>
          Удаление аккаунта необратимо стирает ваш профиль и все данные.
        </Text>
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const Section = ({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) => {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

const Row = ({
  label,
  description,
  right,
}: {
  label: string
  description?: string
  right: React.ReactNode
}) => {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? (
          <Text style={styles.rowDescription}>{description}</Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

const LinkRow = ({ label, onPress }: { label: string; onPress: () => void }) => {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={styles.row}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Chevron style={styles.chevron} />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(5),
  },
  section: { gap: theme.spacing(2) },
  sectionTitle: { ...theme.typography.label },
  sectionBody: {
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
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  rowText: {
    flex: 1,
    paddingRight: theme.spacing(3),
    gap: 2,
  },
  rowLabel: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  rowDescription: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  value: { color: theme.colors.muted, fontSize: 14 },
  action: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(3),
    padding: theme.spacing(4),
  },
  themeItem: {
    alignItems: "center",
    gap: theme.spacing(1),
    width: 64,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: {
    borderColor: theme.colors.text,
  },
  swatchCheck: {
    color: theme.colors.onOverlay,
    fontSize: 18,
    fontWeight: "800",
  },
  themeLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    textAlign: "center",
  },
  modeRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4),
    // No-op on a phone; stops three buttons becoming 270px slabs on desktop.
    maxWidth: CONTROL_MAX_WIDTH + theme.spacing(8),
  },
  modeBtn: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
  },
  modeBtnActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  modeBtnText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  modeBtnTextActive: {
    color: theme.colors.accent,
  },
  dangerButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(4),
    alignItems: "center",
    // A destructive action shouldn't have an 858px-wide invisible hit area.
    maxWidth: CONTROL_MAX_WIDTH,
  },
  dangerButtonText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: "600",
  },
  chevron: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
  rowLast: { borderBottomWidth: 0 },
  dangerRowLabel: {
    color: theme.colors.danger,
    fontSize: 15,
    fontWeight: "600",
  },
  deleteHint: {
    ...theme.typography.caption,
    marginTop: theme.spacing(2),
    paddingHorizontal: theme.spacing(1),
  },
})
