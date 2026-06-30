import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { THEME_KEYS, THEMES } from "@bjj-academy/ui-kit/util"

import { brand } from "../../shared/brand"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { buildColors } from "../../shared/themes"
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
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [cacheSize, setCacheSize] = useState(0)

  useEffect(() => {
    void getPreferences().then(setPrefs)
    void getOfflineRootSizeBytes().then(setCacheSize)
  }, [])

  const update = async (patch: Partial<Preferences>) => {
    const next = await setPreferences(patch)
    setPrefs(next)
  }

  const handleClearCache = () => {
    Alert.alert(
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

  if (!prefs) {
    return <SafeAreaView style={styles.root} />
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="Приложение">
          <Row
            label="Бренд"
            right={<Text style={styles.value}>{brand.displayName}</Text>}
          />
        </Section>

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
          <Row
            label="Новые видео"
            right={
              <Switch
                accessibilityLabel="Уведомления о новых видео"
                value={prefs.notifyNewVideos}
                onValueChange={(v) => update({ notifyNewVideos: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
          <Row
            label="Истечение доступа"
            right={
              <Switch
                accessibilityLabel="Уведомления об истечении доступа"
                value={prefs.notifyAccessExpiring}
                onValueChange={(v) => update({ notifyAccessExpiring: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
        </Section>

        <Section title="Тренировки">
          <Row
            label="Кнопка дрилл-таймера"
            description="Плавающая кнопка ⏱ в углу любого экрана. Выключите, если мешает."
            right={
              <Switch
                accessibilityLabel="Кнопка дрилл-таймера"
                value={prefs.drillFabEnabled}
                onValueChange={(v) => update({ drillFabEnabled: v })}
                trackColor={{
                  true: theme.colors.accent,
                  false: theme.colors.border,
                }}
              />
            }
          />
        </Section>

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
      </ScrollView>
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
  },
  dangerButtonText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: "600",
  },
})
