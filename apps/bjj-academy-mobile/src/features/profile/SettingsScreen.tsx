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

        <Section title="Хранилище">
          <Row
            label="Загруженные видео"
            right={<Text style={styles.value}>{formatBytes(cacheSize)}</Text>}
          />
          <Pressable onPress={handleClearCache} style={styles.dangerButton}>
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
  right,
}: {
  label: string
  right: React.ReactNode
}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    {right}
  </View>
)

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  body: { padding: theme.spacing(4), gap: theme.spacing(4) },
  section: { gap: theme.spacing(2) },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  rowLabel: { color: theme.colors.text, fontSize: 14 },
  value: { color: theme.colors.muted, fontSize: 14 },
  action: { color: theme.colors.accent, fontSize: 14, fontWeight: "500" },
  dangerButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  dangerButtonText: { color: theme.colors.danger, fontSize: 14 },
})
