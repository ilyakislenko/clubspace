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

import { brand } from "../../shared/brand"
import { theme } from "../../shared/theme"
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
          <Row
            label="Язык интерфейса"
            right={
              <Pressable
                onPress={() =>
                  update({
                    language: prefs.language === "ru" ? "en" : "ru",
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Язык интерфейса: ${
                  prefs.language === "ru" ? "Русский" : "English"
                }, изменить`}
              >
                <Text style={styles.action}>
                  {prefs.language === "ru" ? "Русский" : "English"}
                </Text>
              </Pressable>
            }
          />
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
          <Row
            label="Качество по умолчанию"
            right={
              <Pressable
                onPress={() => {
                  const next: Preferences["defaultQuality"] =
                    prefs.defaultQuality === "auto"
                      ? "1080p"
                      : prefs.defaultQuality === "1080p"
                        ? "720p"
                        : prefs.defaultQuality === "720p"
                          ? "480p"
                          : "auto"
                  void update({ defaultQuality: next })
                }}
                accessibilityRole="button"
                accessibilityLabel={`Качество по умолчанию: ${prefs.defaultQuality}, изменить`}
              >
                <Text style={styles.action}>{prefs.defaultQuality}</Text>
              </Pressable>
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
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
)

const Row = ({
  label,
  description,
  right,
}: {
  label: string
  description?: string
  right: React.ReactNode
}) => (
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

const styles = StyleSheet.create({
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
