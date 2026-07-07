import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useMemo, useState } from "react"
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { listCourses, type CourseSummary } from "../../shared/api/courses"
import { CourseCard } from "./CourseCard"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { brand } from "../../shared/brand"
import { useToast } from "../../shared/components/Toast"
import { haptics } from "../../shared/haptics"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
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

export function CoursesScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const [query, setQuery] = useState("")
  const [offlineCount, setOfflineCount] = useState(0)
  const [hasRecents, setHasRecents] = useState(false)
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent")
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])

  // Read-through cache: paints the last course list instantly (works offline),
  // then revalidates on focus / pull-to-refresh / realtime invalidation. We
  // fetch the whole list once (no server `q`) and filter on-device below, so
  // search is instant — no round-trip per keystroke, and it works offline too.
  const { data, error, loading, refreshing, refetch } =
    useCachedResource<CourseSummary[]>(
      workspace ? `courses:${workspace.workspaceId}` : null,
      useCallback(
        async () =>
          (
            await listCourses({
              workspaceId: workspace!.workspaceId,
              perPage: 100,
            })
          ).data,
        [workspace],
      ),
    )
  const courses = data ?? []

  // Client-side search mirrors the server's: a case-insensitive substring on
  // title/description, or an exact tag match.
  const trimmedQuery = query.trim()
  const filtered = useMemo(() => {
    const list = data ?? []
    const term = trimmedQuery.toLowerCase()
    if (!term) return list
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(term) ||
        (c.description?.toLowerCase().includes(term) ?? false) ||
        c.tags.some((t) => t.toLowerCase() === term),
    )
  }, [data, trimmedQuery])

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
        ? [...filtered].sort((a, b) => a.title.localeCompare(b.title, "ru"))
        : [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (pinnedSet.size === 0) return base
    const pinned: CourseSummary[] = []
    const rest: CourseSummary[] = []
    for (const c of base) {
      if (pinnedSet.has(c.id)) pinned.push(c)
      else rest.push(c)
    }
    return [...pinned, ...rest]
  }, [filtered, sort, pinnedSet])

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
            haptics.light()
            showToast(next ? "Курс закреплён" : "Курс откреплён")
          },
        },
      ],
    )
  }

  const dismissOnboarding = async () => {
    setShowOnboarding(false)
    await setPreferences({ onboardingSeen: true })
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
          accessibilityRole="button"
          accessibilityLabel="Профиль"
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
          accessibilityRole="button"
          accessibilityHint="Закрыть подсказки"
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
            accessibilityRole="button"
            accessibilityLabel="Продолжить просмотр"
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
          accessibilityRole="button"
          accessibilityLabel={`Загруженные${
            offlineCount > 0 ? `, ${offlineCount}` : ""
          }`}
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
        {trimmedQuery.length > 0 && !loading && !error && (
          <Text style={styles.searchResults}>
            {filtered.length === 0
              ? "Ничего не найдено"
              : `Найдено: ${filtered.length}`}
          </Text>
        )}
      </View>

      <View style={styles.sortRow}>
        <Pressable
          onPress={() => setSort("recent")}
          accessibilityRole="button"
          accessibilityLabel="Сортировать: недавние"
          accessibilityState={{ selected: sort === "recent" }}
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
          accessibilityRole="button"
          accessibilityLabel="Сортировать: по алфавиту"
          accessibilityState={{ selected: sort === "alphabetical" }}
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
        // Full skeleton only on the very first load with nothing cached. Once a
        // list is on screen it stays put: searching filters it in place, and a
        // background revalidation never blanks it.
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.card, styles.cardSkeleton]} />
          ))}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={refetch}
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
              onRefresh={refetch}
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
            <CourseCard
              course={item}
              query={trimmedQuery}
              pinned={pinnedSet.has(item.id)}
              onPress={() =>
                navigation.navigate("CourseDetail", {
                  courseId: item.id,
                  title: item.title,
                })
              }
              onLongPress={() => handleTogglePin(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
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
