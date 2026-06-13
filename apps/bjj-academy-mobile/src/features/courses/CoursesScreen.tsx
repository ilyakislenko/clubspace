import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
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
  listPinnedCourses,
  listRecents,
  setPreferences,
  togglePinnedCourse,
} from "../profile/preferences-store"
import type { RootStackParamList } from "../../app/navigation"
import { useFocusEffect } from "@react-navigation/native"

type Props = NativeStackScreenProps<RootStackParamList, "Courses">

const escapeRegex = (input: string) =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type HighlightedTextProps = {
  text: string
  query: string
  style?: React.ComponentProps<typeof Text>["style"]
  highlightStyle?: React.ComponentProps<typeof Text>["style"]
  numberOfLines?: number
}

const HighlightedText = ({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
}: HighlightedTextProps) => {
  const trimmed = query.trim()
  if (trimmed.length === 0) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    )
  }
  const re = new RegExp(`(${escapeRegex(trimmed)})`, "ig")
  const parts = text.split(re)
  const lowerQuery = trimmed.toLowerCase()
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, idx) =>
        part.toLowerCase() === lowerQuery ? (
          <Text key={idx} style={highlightStyle}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  )
}

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
  const [pinnedIds, setPinnedIds] = useState<string[]>([])

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
        listPinnedCourses(),
      ]).then(([offline, recents, prefs, pinned]) => {
        setOfflineCount(offline.length)
        setHasRecents(recents.length > 0)
        if (!prefs.onboardingSeen) setShowOnboarding(true)
        setPinnedIds(pinned)
      })
    }, []),
  )

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])

  const sortedCourses = useMemo(() => {
    const base =
      sort === "alphabetical"
        ? [...courses].sort((a, b) => a.title.localeCompare(b.title, "ru"))
        : [...courses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (pinnedSet.size === 0) return base
    const pinned: CourseSummary[] = []
    const rest: CourseSummary[] = []
    for (const c of base) {
      if (pinnedSet.has(c.id)) pinned.push(c)
      else rest.push(c)
    }
    return [...pinned, ...rest]
  }, [courses, sort, pinnedSet])

  const handleTogglePin = (course: CourseSummary) => {
    const currentlyPinned = pinnedSet.has(course.id)
    Alert.alert(
      currentlyPinned ? "Открепить курс?" : "Закрепить курс?",
      course.title,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: currentlyPinned ? "Открепить" : "Закрепить",
          onPress: async () => {
            const next = await togglePinnedCourse(course.id)
            setPinnedIds((prev) =>
              next ? [...prev, course.id] : prev.filter((id) => id !== course.id),
            )
          },
        },
      ],
    )
  }

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
          <Text style={styles.headerEyebrow}>{brand.tagline}</Text>
          <Text style={styles.headerTitle}>
            {workspace?.name ?? brand.displayName}
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate("Profile")}
          hitSlop={8}
          style={({ pressed }) => [
            styles.profilePill,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.profilePillText}>Профиль</Text>
        </Pressable>
      </View>

      {showOnboarding && (
        <Pressable
          onPress={dismissOnboarding}
          style={styles.onboardingCard}
        >
          <Text style={styles.onboardingTitle}>
            Подсказки
          </Text>
          <Text style={styles.onboardingText}>
            • Откройте видео и «Скачать» — будет доступно офлайн.{"\n"}
            • Долго удерживайте курс, чтобы закрепить его сверху.
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
        <View style={styles.searchInputWrap}>
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
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={10}
              style={styles.searchClear}
            >
              <Text style={styles.searchClearText}>✕</Text>
            </Pressable>
          )}
        </View>
        {debouncedQuery.length > 0 && !loading && !error && (
          <Text style={styles.searchResults}>
            {courses.length === 0
              ? "Ничего не найдено"
              : `Найдено: ${courses.length}`}
          </Text>
        )}
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

      {loading && courses.length === 0 ? (
        // Full skeleton only when there's nothing to show yet. During a
        // debounced-search refetch the existing list stays put and updates in
        // place, instead of flashing the skeleton on every keystroke.
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.card, styles.cardSkeleton]} />
          ))}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedCourses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Пока пусто</Text>
              <Text style={styles.emptyHint}>
                Когда тренер загрузит курс — он появится здесь.
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
              onLongPress={() => handleTogglePin(item)}
              delayLongPress={400}
              style={({ pressed }) => [
                styles.card,
                pinnedSet.has(item.id) && styles.cardPinned,
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
                <View style={styles.cardTitleRow}>
                  {pinnedSet.has(item.id) && (
                    <Text style={styles.pinBadge}>📌</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <HighlightedText
                      text={item.title}
                      query={debouncedQuery}
                      style={styles.cardTitle}
                      highlightStyle={styles.cardTitleHighlight}
                      numberOfLines={2}
                    />
                  </View>
                </View>
                {item.description && (
                  <HighlightedText
                    text={item.description}
                    query={debouncedQuery}
                    style={styles.cardDesc}
                    highlightStyle={styles.cardDescHighlight}
                    numberOfLines={2}
                  />
                )}
                {item.tags?.length > 0 && (
                  <View style={styles.tagRow}>
                    {item.tags.slice(0, 3).map((tag) => (
                      <View key={tag} style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
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
    paddingHorizontal: theme.spacing(5),
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(3),
    gap: theme.spacing(3),
  },
  headerEyebrow: {
    ...theme.typography.label,
    marginBottom: 4,
  },
  headerTitle: {
    ...theme.typography.title,
    color: theme.colors.text,
  },
  profilePill: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  profilePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.text,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  shortcuts: {
    flexDirection: "row",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(5),
    paddingTop: theme.spacing(2),
  },
  shortcut: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  shortcutPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  shortcutText: {
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: "600",
  },
  sortRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(5),
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(1),
  },
  sortChip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sortChipActive: {
    backgroundColor: theme.colors.text,
    borderColor: theme.colors.text,
  },
  sortChipText: { fontSize: 12, color: theme.colors.muted, fontWeight: "600" },
  sortChipTextActive: {
    color: theme.colors.accentText,
  },
  onboardingCard: {
    marginHorizontal: theme.spacing(5),
    marginTop: theme.spacing(3),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.accentSoft,
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
    color: theme.colors.textSecondary,
    lineHeight: 19,
  },
  onboardingDismiss: {
    fontSize: 12,
    color: theme.colors.accent,
    fontWeight: "700",
    marginTop: theme.spacing(1),
  },
  searchWrap: {
    paddingHorizontal: theme.spacing(5),
    paddingTop: theme.spacing(3),
  },
  searchInputWrap: {
    position: "relative",
  },
  searchInput: {
    height: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(4),
    paddingRight: theme.spacing(10),
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
  },
  searchClear: {
    position: "absolute",
    right: theme.spacing(2),
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  searchClearText: {
    fontSize: 14,
    color: theme.colors.muted,
    fontWeight: "600",
  },
  searchResults: {
    marginTop: theme.spacing(2),
    fontSize: 12,
    color: theme.colors.muted,
    fontWeight: "600",
  },
  list: {
    padding: theme.spacing(5),
    paddingTop: theme.spacing(3),
    gap: theme.spacing(3),
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(6),
    gap: theme.spacing(3),
  },
  empty: {
    alignItems: "center",
    paddingTop: theme.spacing(12),
    paddingHorizontal: theme.spacing(8),
    gap: theme.spacing(2),
  },
  emptyTitle: {
    ...theme.typography.heading,
    color: theme.colors.text,
  },
  emptyHint: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing(3),
    ...theme.shadows.sm,
  },
  cardSkeleton: {
    height: 100,
    backgroundColor: theme.colors.surfaceMuted,
  },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  cardPinned: {
    borderColor: theme.colors.accent,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pinBadge: {
    fontSize: 12,
  },
  thumb: {
    width: 128,
    height: 80,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    margin: theme.spacing(2),
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: { fontSize: 11, color: theme.colors.mutedFaint },
  cardBody: {
    flex: 1,
    padding: theme.spacing(4),
    paddingLeft: theme.spacing(3),
    gap: theme.spacing(1),
    justifyContent: "center",
  },
  cardTitle: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  cardTitleHighlight: {
    color: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  cardDesc: {
    ...theme.typography.caption,
    color: theme.colors.muted,
  },
  cardDescHighlight: {
    color: theme.colors.text,
    backgroundColor: theme.colors.accentSoft,
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  tagText: { fontSize: 11, color: theme.colors.muted, fontWeight: "600" },
  muted: { color: theme.colors.muted, fontSize: 14 },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.text,
  },
  retryText: {
    color: theme.colors.accentText,
    fontSize: 14,
    fontWeight: "600",
  },
})
