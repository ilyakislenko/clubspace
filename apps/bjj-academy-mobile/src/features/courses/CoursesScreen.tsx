import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { listCourses, type CourseSummary } from "../../shared/api/courses"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { theme } from "../../shared/theme"
import { listOfflineEntries } from "../offline/offline-store"
import {
  getPreferences,
  listRecents,
  setPreferences,
} from "../profile/preferences-store"
import type { RootStackParamList } from "../../app/navigation"
import { useFocusEffect } from "@react-navigation/native"

type Props = NativeStackScreenProps<RootStackParamList, "Courses">

export function CoursesScreen({ navigation }: Props) {
  const { workspace } = useAuth()
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [offlineCount, setOfflineCount] = useState(0)
  const [hasRecents, setHasRecents] = useState(false)
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent")
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(handle)
  }, [query])

  const load = useCallback(async () => {
    if (!workspace) return
    setError(null)
    try {
      const response = await listCourses({
        workspaceId: workspace.workspaceId,
        perPage: 100,
        q: debouncedQuery || undefined,
      })
      setCourses(response.data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить курсы.",
      )
    }
  }, [workspace, debouncedQuery])

  useEffect(() => {
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        listOfflineEntries(),
        listRecents(),
        getPreferences(),
      ]).then(([offline, recents, prefs]) => {
        setOfflineCount(offline.length)
        setHasRecents(recents.length > 0)
        if (!prefs.onboardingSeen) setShowOnboarding(true)
      })
    }, []),
  )

  const dismissOnboarding = async () => {
    setShowOnboarding(false)
    await setPreferences({ onboardingSeen: true })
  }

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {workspace?.name ?? brand.displayName}
          </Text>
          <Text style={styles.headerSubtitle}>Курсы</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate("Profile")}
          hitSlop={8}
        >
          <Text style={styles.signOut}>Профиль</Text>
        </Pressable>
      </View>

      {showOnboarding && (
        <Pressable
          onPress={dismissOnboarding}
          style={styles.onboardingCard}
        >
          <Text style={styles.onboardingTitle}>
            Подсказка: смотрите без интернета
          </Text>
          <Text style={styles.onboardingText}>
            Откройте видео, нажмите «Скачать» — и оно станет доступно офлайн.
            Все скачанные видео — в разделе «Загруженные».
          </Text>
          <Text style={styles.onboardingDismiss}>Закрыть</Text>
        </Pressable>
      )}

      <View style={styles.shortcuts}>
        {hasRecents && (
          <Pressable
            onPress={() => navigation.navigate("ContinueWatching")}
            style={({ pressed }) => [
              styles.shortcut,
              pressed && styles.shortcutPressed,
            ]}
          >
            <Text style={styles.shortcutText}>Продолжить</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => navigation.navigate("OfflineLibrary")}
          style={({ pressed }) => [
            styles.shortcut,
            pressed && styles.shortcutPressed,
          ]}
        >
          <Text style={styles.shortcutText}>
            Загруженные{offlineCount > 0 ? ` · ${offlineCount}` : ""}
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск курса..."
          placeholderTextColor={theme.colors.muted}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <View style={styles.sortRow}>
        <Pressable
          onPress={() => setSort("recent")}
          style={({ pressed }) => [
            styles.sortChip,
            sort === "recent" && styles.sortChipActive,
            pressed && styles.shortcutPressed,
          ]}
        >
          <Text
            style={[
              styles.sortChipText,
              sort === "recent" && styles.sortChipTextActive,
            ]}
          >
            Недавние
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSort("alphabetical")}
          style={({ pressed }) => [
            styles.sortChip,
            sort === "alphabetical" && styles.sortChipActive,
            pressed && styles.shortcutPressed,
          ]}
        >
          <Text
            style={[
              styles.sortChipText,
              sort === "alphabetical" && styles.sortChipTextActive,
            ]}
          >
            По алфавиту
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={onRefresh} style={styles.retryButton}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={
            sort === "alphabetical"
              ? [...courses].sort((a, b) => a.title.localeCompare(b.title, "ru"))
              : [...courses].sort((a, b) =>
                  b.updatedAt.localeCompare(a.updatedAt),
                )
          }
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>
                Курсов пока нет. Загляните позже.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate("CourseDetail", {
                  courseId: item.id,
                  title: item.title,
                })
              }
              style={({ pressed }) => [
                styles.card,
                pressed && styles.cardPressed,
              ]}
            >
              <View style={styles.thumb}>
                {item.thumbnailUrl ? (
                  <Image
                    source={{ uri: item.thumbnailUrl }}
                    style={styles.thumbImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.thumbPlaceholder}>Нет превью</Text>
                )}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.description && (
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
  headerSubtitle: { fontSize: 12, color: theme.colors.muted },
  signOut: { color: theme.colors.muted, fontSize: 14 },
  shortcuts: {
    flexDirection: "row",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(3),
  },
  shortcut: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  shortcutPressed: { opacity: 0.7 },
  shortcutText: {
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: "500",
  },
  sortRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(2),
  },
  sortChip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sortChipActive: {
    backgroundColor: theme.colors.text,
    borderColor: theme.colors.text,
  },
  sortChipText: { fontSize: 12, color: theme.colors.muted },
  sortChipTextActive: {
    color: theme.colors.accentText,
    fontWeight: "600",
  },
  onboardingCard: {
    marginHorizontal: theme.spacing(4),
    marginTop: theme.spacing(3),
    padding: theme.spacing(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    gap: theme.spacing(1),
  },
  onboardingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.text,
  },
  onboardingText: {
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 18,
  },
  onboardingDismiss: {
    fontSize: 12,
    color: theme.colors.accent,
    fontWeight: "600",
    marginTop: theme.spacing(1),
  },
  searchWrap: {
    paddingHorizontal: theme.spacing(4),
    paddingTop: theme.spacing(3),
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(3),
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  list: { padding: theme.spacing(4), gap: theme.spacing(3) },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(6),
    gap: theme.spacing(3),
  },
  card: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing(3),
  },
  cardPressed: { opacity: 0.85 },
  thumb: {
    width: 120,
    alignSelf: "stretch",
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: { fontSize: 11, color: theme.colors.muted },
  cardBody: { flex: 1, padding: theme.spacing(3), gap: theme.spacing(1) },
  cardTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
  cardDesc: { fontSize: 13, color: theme.colors.muted },
  muted: { color: theme.colors.muted, fontSize: 14 },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
  retryButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryText: { color: theme.colors.text, fontSize: 14 },
})
