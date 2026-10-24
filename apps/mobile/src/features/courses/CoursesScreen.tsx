import React, { useCallback, useMemo, useState } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { showAlert } from "../../shared/alert"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
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
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { supportsOfflineDownload } from "../../shared/platform"
import { columnsFor } from "../../shared/size-class"
import { useResponsive } from "../../shared/useResponsive"
import { listOfflineEntries } from "../offline/offline-store"
import {
  getPreferences,
  listPinnedCourses,
  listRecents,
  setPreferences,
  togglePinnedCourse,
} from "../profile/preferences-store"
import type { TabScreenProps } from "../../app/navigation"
import { DrillModeButton } from "../video/DrillMode"
import { useFocusEffect } from "@react-navigation/native"

type Props = TabScreenProps<"Courses">

export function CoursesScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { sizeClass, gridGap } = useResponsive()
  // Course cards go two-up on medium windows and three-up on expanded ones
  // (tablet / desktop browser); phones stay single-column. The key change
  // remounts the list, as RN requires when numColumns changes.
  const numColumns = columnsFor(sizeClass, {
    compact: 1,
    medium: 2,
    expanded: 3,
  })
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const [query, setQuery] = useState("")
  // While typing a query the keyboard takes half a landscape screen; the
  // tips, shortcuts and sort chips step aside so the results stay visible.
  const [searching, setSearching] = useState(false)
  const [offlineCount, setOfflineCount] = useState(0)
  const [hasRecents, setHasRecents] = useState(false)
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent")
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])

  // Read-through cache: paints the last course list instantly (works offline),
  // then revalidates on focus / pull-to-refresh / realtime invalidation. We
  // fetch the whole list once (no server `q`) and filter on-device below, so
  // search is instant — no round-trip per keystroke, and it works offline too.
  const { data, error, loading, refreshing, stale, refetch } =
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
  // The club hasn't published anything: search, sort and the tips have nothing
  // to act on, so only the empty state is shown.
  const noCourses = !!data && courses.length === 0

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
    showAlert(
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
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>
            {workspace?.name ?? brand.displayName}
          </Text>
          <Text style={styles.headerTitle}>Видео</Text>
        </View>
        <DrillModeButton />
      </View>

      {showOnboarding && !noCourses && !searching && (
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
            {supportsOfflineDownload
              ? "• Откройте видео и «Скачать» — будет доступно офлайн.\n"
              : ""}
            • Долго удерживайте курс, чтобы закрепить его сверху.
          </Text>
          <Text style={styles.onboardingDismiss}>Закрыть</Text>
        </Pressable>
      )}

      {(hasRecents || supportsOfflineDownload) && !searching && (
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
          {supportsOfflineDownload && (
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
          )}
        </View>
      )}

      {/* The home screen was the one cached screen that never said it was
          showing stale data — offline, the course list just appeared, hours
          old, with nothing to explain why nothing new had arrived. */}
      {stale && data ? (
        <View style={styles.offlineWrap}>
          <OfflineNotice />
        </View>
      ) : null}

      {!noCourses && (
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
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
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
        {trimmedQuery.length > 0 && !loading && !error && filtered.length > 0 && (
          <Text style={styles.searchResults}>Найдено: {filtered.length}</Text>
        )}
      </View>
      )}

      {!noCourses && !searching && (
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
      )}

      <KeyboardAvoidingContainer>
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
          // A tap on a course while searching opens it instead of only closing
          // the keyboard; scrolling the results puts the keyboard away.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          data={sortedCourses}
          key={numColumns}
          numColumns={numColumns}
          columnWrapperStyle={
            numColumns > 1
              ? [styles.gridRow, { marginHorizontal: -gridGap / 2 }]
              : undefined
          }
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
            trimmedQuery ? (
              <View style={styles.empty}>
                <Text style={styles.emptyHint}>Ничего не найдено</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Курсов пока нет</Text>
                <Text style={styles.emptyHint}>
                  Клуб ещё не опубликовал ни одного курса. Как только курс
                  появится, он будет здесь.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const card = (
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
            )
            // In grid mode each cell must flex so the row splits evenly.
            return numColumns > 1 ? (
              <View
                style={{
                  width: `${100 / numColumns}%`,
                  paddingHorizontal: gridGap / 2,
                }}
              >
                {card}
              </View>
            ) : (
              card
            )
          }}
        />
      )}
      </KeyboardAvoidingContainer>
      </CenteredColumn>
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
    // Reads against the `colors.text` fill in every theme; a fixed white
    // label vanished on the dark ones, where that fill is near-white.
    color: theme.colors.inverseText,
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
  offlineWrap: {
    paddingHorizontal: theme.spacing(5),
    paddingTop: theme.spacing(3),
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
  // Grid (tablet / desktop): fixed-width cells (set inline from the column
  // count and grid gap) rather than flex, so a short last row keeps the same
  // cell width instead of stretching full-bleed.
  gridRow: { alignItems: "flex-start" },
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
    color: theme.colors.inverseText,
    fontSize: 14,
    fontWeight: "600",
  },
})
