import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  getAnnouncementFeed,
  type Announcement,
} from "../../shared/api/announcements"
import { useAuth } from "../../shared/auth-context"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const PER_PAGE = 30

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

export function AnnouncementsScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const [items, setItems] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      const page = await getAnnouncementFeed({
        workspaceId: workspace.workspaceId,
        perPage: PER_PAGE,
      })
      setItems(page.data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить анонсы"))
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  if (!workspace) return null

  if (items === null && !error) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <Text style={styles.title}>Анонсы</Text>

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

        {items && items.length === 0 && !error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Пока нет анонсов.</Text>
          </View>
        )}

        {items?.map((a: Announcement) => (
          <View key={a.id} style={styles.card}>
            {a.pinned && (
              <View style={styles.pinChip}>
                <Text style={styles.pinChipText}>📌 Закреплено</Text>
              </View>
            )}
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.cardBody}>{a.body}</Text>
            <Text style={styles.cardMeta}>
              {a.authorName} · {fmtDate(a.publishedAt ?? a.createdAt)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    banner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    bannerText: { color: theme.colors.muted, fontSize: 14 },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 6,
    },
    pinChip: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
    },
    pinChipText: {
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    cardBody: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    cardMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  })
