import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { showAlert } from "../../shared/alert"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, SheetRow, useSheetAction } from "../../shared/components/Sheet"
import { TextInput } from "../../shared/components/TextInput"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import { CourseLessonRow } from "./CourseLessonRow"
import { LockBadge } from "./LockBadge"
import {
  courseAction,
  courseMetaLine,
  lessonProgress,
  stripCourseTitle,
  type LessonProgress,
  type PlaybackEntry,
} from "./course-detail"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { errorMessage } from "../../shared/error-message"
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { CONTROL_MAX_WIDTH, useResponsive } from "../../shared/useResponsive"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  cacheCourse,
  getCachedCourse,
  removeOffline,
} from "../offline/offline-store"
import {
  bulkResultMessage,
  type BulkDownloadTarget,
} from "../offline/bulk-download"
import {
  useBulkDownload,
  type BulkDownload,
  type BulkDownloadCopy,
} from "../offline/use-bulk-download"
import { useFocusEffect } from "@react-navigation/native"
import {
  getProgressMap,
  markCompleted,
  unmarkCompleted,
} from "../video/playback-progress"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "CourseDetail">

const COURSE_BULK_COPY: BulkDownloadCopy = {
  confirmTitle: "Скачать весь курс?",
  allDoneTitle: "Курс уже скачан",
  allDoneMessage: "Все доступные видео уже в загруженном.",
}

// A short course is scanned by eye; search and filters only pay off past this.
const FINDER_MIN_LESSONS = 9

type LessonFilter = "all" | "unwatched" | "in-progress"

const FILTERS: readonly { key: LessonFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "unwatched", label: "Непросмотренные" },
  { key: "in-progress", label: "В процессе" },
]

export function CourseDetailScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { sizeClass } = useResponsive()
  const { courseId } = route.params
  // The lesson search sits under the course hero, so on a short screen the
  // matches land below the fold; focusing it scrolls it to the top.
  const listRef = useRef<FlatList>(null)
  const searchY = useRef(0)
  const { workspace } = useAuth()
  const offlineDownloads = useOfflineDownloadsAllowed()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<LessonFilter>("all")
  // «Ещё»: its choices run once it's dismissed — two of them open an alert,
  // which iOS can't show over a dismissing sheet.
  const menu = useSheetAction()
  // Locked lessons can't be downloaded, so they're not on offer.
  const bulkTargets = useMemo<BulkDownloadTarget[]>(
    () =>
      course
        ? course.videos
            .filter((v) => v.status === "ready" && !v.lock)
            .map((v) => ({ videoId: v.id, thumbnailUrl: v.thumbnailUrl, course }))
        : [],
    [course],
  )
  const bulk = useBulkDownload({
    workspaceId: workspace?.workspaceId ?? null,
    targets: bulkTargets,
    copy: COURSE_BULK_COPY,
  })
  const { offlineSet } = bulk
  const [isOfflineSource, setIsOfflineSource] = useState(false)
  const [progressMap, setProgressMap] = useState<
    Record<string, PlaybackEntry>
  >({})

  const loadCourse = async (): Promise<void> => {
    if (!workspace) return
    try {
      const data = await getCourse({
        workspaceId: workspace.workspaceId,
        courseId,
      })
      setCourse(data)
      setIsOfflineSource(false)
      navigation.setOptions({ title: data.title })
      void cacheCourse(data)
      setError(null)
    } catch (err) {
      const cached = await getCachedCourse(courseId)
      if (cached) {
        setCourse(cached)
        setIsOfflineSource(true)
        navigation.setOptions({ title: cached.title })
      } else {
        setError(
          errorMessage(err, "Не удалось загрузить курс."),
        )
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadCourse().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, workspace])

  // Coming back from a lesson: refetch so locked-progression lessons the
  // student just finished unlock (and a changed audience shows). The first
  // focus is the initial load above.
  const focusedOnce = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true
        return
      }
      void loadCourse()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseId, workspace]),
  )

  // The store hands out its cached map and mutates it in place: copy it so a
  // change re-renders.
  const refreshProgress = useCallback(async () => {
    setProgressMap({ ...(await getProgressMap()) })
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshProgress()
    }, [refreshProgress]),
  )

  const progressByVideo = useMemo(() => {
    const byVideo: Record<string, LessonProgress> = {}
    for (const v of course?.videos ?? []) {
      const row = lessonProgress(progressMap[v.id], v.duration)
      if (row) byVideo[v.id] = row
    }
    return byVideo
  }, [course, progressMap])

  const watchedCount = useMemo(
    () =>
      Object.values(progressByVideo).filter((p) => p.status === "watched")
        .length,
    [progressByVideo],
  )

  const action = useMemo(
    () =>
      course && !course.lock
        ? courseAction(
            course.videos.map((v) => ({
              id: v.id,
              duration: v.duration,
              playable:
                !v.lock && (v.status === "ready" || offlineSet.has(v.id)),
            })),
            progressMap,
          )
        : null,
    [course, offlineSet, progressMap],
  )

  // Every downloaded lesson of the course, locked ones included.
  const downloadedIds = useMemo(
    () =>
      offlineDownloads && course
        ? course.videos.filter((v) => offlineSet.has(v.id)).map((v) => v.id)
        : [],
    [course, offlineDownloads, offlineSet],
  )

  const downloading = bulk.state.status === "downloading"
  // A course loaded from the cache can't fetch lessons.
  const canStartDownload =
    !isOfflineSource && bulk.total > 0 && !bulk.allDownloaded
  const showMenu =
    offlineDownloads &&
    !!course &&
    !course.lock &&
    (downloading || canStartDownload || downloadedIds.length > 0)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: showMenu
        ? () => (
            <Pressable
              onPress={menu.open}
              accessibilityRole="button"
              accessibilityLabel="Ещё"
              hitSlop={8}
              style={styles.headerButton}
            >
              <Icon
                name="ellipsis-horizontal"
                size={22}
                color={theme.colors.text}
              />
            </Pressable>
          )
        : undefined,
    })
  }, [navigation, showMenu, styles, theme, menu.open])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadCourse()
    setRefreshing(false)
  }

  const handleToggleWatched = async (
    videoId: string,
    isWatched: boolean,
  ) => {
    if (isWatched) {
      await unmarkCompleted(videoId)
    } else {
      await markCompleted(videoId)
    }
    await refreshProgress()
  }

  const confirmRemoveDownloads = () => {
    const ids = downloadedIds
    showAlert(
      "Удалить загрузки курса?",
      `Видео: ${ids.length}. Их можно будет скачать снова.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            for (const id of ids) await removeOffline(id)
            bulk.refresh()
          },
        },
      ],
    )
  }

  const showFinder = (course?.videos.length ?? 0) >= FINDER_MIN_LESSONS

  const filteredVideos = useMemo(() => {
    if (!course) return []
    if (!showFinder) return course.videos
    const q = query.trim().toLowerCase()
    return course.videos.filter((v) => {
      const status = progressByVideo[v.id]?.status
      if (filter === "unwatched" && status === "watched") return false
      if (filter === "in-progress" && status !== "in-progress") return false
      if (!q) return true
      return (
        v.title.toLowerCase().includes(q) ||
        (v.description ?? "").toLowerCase().includes(q)
      )
    })
  }, [course, showFinder, query, filter, progressByVideo])

  // The lesson's place in the course, whatever the filter shows.
  const orderById = useMemo(
    () => new Map((course?.videos ?? []).map((v, i) => [v.id, i + 1])),
    [course],
  )

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  if (error || !course) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ErrorRetry
          message={error ?? "Курс не найден."}
          onRetry={() => {
            setError(null)
            setLoading(true)
            void loadCourse().finally(() => setLoading(false))
          }}
        />
      </SafeAreaView>
    )
  }

  const openLesson = (
    video: CourseDetail["videos"][number],
    startAt?: number,
  ) =>
    navigation.navigate("Video", {
      videoId: video.id,
      courseId: course.id,
      title: video.title,
      ...(startAt != null ? { startAt } : {}),
    })

  const actionVideo = action
    ? course.videos.find((v) => v.id === action.videoId)
    : undefined
  const total = course.videos.length

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      {/* The lesson search sits under the course hero; on a landscape tablet
          the keyboard covered it. Edge-to-edge Android doesn't shrink the
          window, so the list does. */}
      <KeyboardAvoidingContainer
        style={styles.flex}
      >
      <FlatList
        ref={listRef}
        data={filteredVideos}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {course.thumbnailUrl ? (
              <View style={styles.hero}>
                <Image
                  source={{ uri: course.thumbnailUrl }}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
                <View style={styles.heroOverlay} />
              </View>
            ) : null}
            <Text style={styles.title}>{course.title}</Text>
            <Text style={styles.muted}>
              {courseMetaLine({
                lessons: total,
                watched: watchedCount,
                downloaded: downloadedIds.length,
                offline: isOfflineSource,
              })}
            </Text>
            {watchedCount > 0 && total > 0 && (
              <View style={styles.courseProgressTrack}>
                <View
                  style={[
                    styles.courseProgressFill,
                    { width: `${(watchedCount / total) * 100}%` },
                  ]}
                />
              </View>
            )}
            {course.description ? (
              <Text style={styles.description}>{course.description}</Text>
            ) : null}
            {course.lock ? (
              <View style={styles.lockBox}>
                <LockBadge reason={course.lock.reason} />
                <Text style={styles.muted}>
                  Уроки курса откроются, когда условие выполнится. Пока можно
                  посмотреть, что в нём есть.
                </Text>
              </View>
            ) : course.lockedProgression ? (
              <Text style={styles.muted}>
                Уроки открываются по порядку: следующий — после просмотра
                предыдущего хотя бы на 90%.
              </Text>
            ) : null}

            {action && actionVideo && (
              <Pressable
                onPress={() => openLesson(actionVideo, action.startAt)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  {action.label}
                </Text>
              </Pressable>
            )}

            <DownloadStatus bulk={bulk} />

            {showFinder && (
              <View
                style={[
                  styles.finder,
                  sizeClass !== "compact" && styles.finderWide,
                ]}
                // The finder is a direct child of the list header, so its y
                // is the list offset to scroll the search to.
                onLayout={(e) => {
                  searchY.current = e.nativeEvent.layout.y
                }}
              >
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Поиск по урокам"
                  placeholderTextColor={theme.colors.muted}
                  style={[
                    styles.search,
                    sizeClass !== "compact" && styles.searchWide,
                  ]}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  onFocus={() => {
                    // After the keyboard has opened and the list has shrunk.
                    setTimeout(() => {
                      listRef.current?.scrollToOffset({
                        offset: Math.max(0, searchY.current - 8),
                        animated: true,
                      })
                    }, 300)
                  }}
                />
                <View style={styles.filterChips}>
                  {FILTERS.map((option) => {
                    const active = filter === option.key
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => setFilter(option.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`Фильтр: ${option.label}`}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.filterChip,
                          active && styles.filterChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            active && styles.filterChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>
              {total > 0 ? "Ничего не найдено." : "В этом курсе пока нет видео."}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const offline = offlineSet.has(item.id)
          const progress = progressByVideo[item.id]
          const prev = index > 0 ? filteredVideos[index - 1] : null
          const showChapterHeader =
            !!item.chapterTitle &&
            item.chapterTitle !== (prev?.chapterTitle ?? null)
          return (
            <CourseLessonRow
              video={item}
              title={stripCourseTitle(item.title, course.title)}
              number={orderById.get(item.id) ?? index + 1}
              offline={offline}
              progress={progress}
              showChapterHeader={showChapterHeader}
              onPress={() => {
                if (item.lock) {
                  showAlert("Урок пока закрыт", item.lock.reason)
                  return
                }
                openLesson(item)
              }}
              onToggleWatched={
                // Under locked progression only really watching counts.
                item.lock || course.lockedProgression
                  ? undefined
                  : () =>
                      void handleToggleWatched(
                        item.id,
                        progress?.status === "watched",
                      )
              }
            />
          )
        }}
      />
      </KeyboardAvoidingContainer>
      </CenteredColumn>

      {menu.mounted && (
        <Sheet title="Ещё" {...menu.sheetProps}>
          {downloading ? (
            bulk.state.status === "downloading" && bulk.state.stopping ? (
              <Text style={styles.muted}>Остановка после текущего видео…</Text>
            ) : (
              <SheetRow
                label="Остановить загрузку"
                onPress={() => menu.run(bulk.stop)}
              />
            )
          ) : canStartDownload ? (
            <SheetRow
              label="Скачать весь курс"
              onPress={() => menu.run(() => void bulk.start())}
            />
          ) : null}
          {!downloading && downloadedIds.length > 0 && (
            <SheetRow
              label="Удалить загрузки"
              count={downloadedIds.length}
              onPress={() => menu.run(confirmRemoveDownloads)}
            />
          )}
        </Sheet>
      )}
    </SafeAreaView>
  )
}

/** The running course download (or its result), only while there is one. */
function DownloadStatus({ bulk }: { bulk: BulkDownload }) {
  const styles = useThemedStyles(makeStyles)
  const { state } = bulk
  if (state.status === "idle") return null
  return (
    <Text style={styles.muted}>
      {state.status === "downloading"
        ? `Скачивание: ${state.currentIndex + 1} из ${state.totalVideos} · ${
            state.stopping ? "остановка…" : state.videoPhase
          }`
        : bulkResultMessage(state)}
    </Text>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: {
    padding: theme.spacing(5),
    paddingTop: theme.spacing(4),
  },
  header: { gap: theme.spacing(2), marginBottom: theme.spacing(3) },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    height: 180,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceMuted,
    marginBottom: theme.spacing(2),
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.colors.overlaySoft,
  },
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
  },
  description: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  muted: { ...theme.typography.caption },
  primaryButton: {
    // A phone's full width; on a tablet a button, not a 700px slab.
    width: "100%",
    maxWidth: CONTROL_MAX_WIDTH,
    alignSelf: "flex-start",
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    marginTop: theme.spacing(2),
    ...theme.shadows.sm,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  finder: { gap: theme.spacing(2), marginTop: theme.spacing(3) },
  finderWide: { flexDirection: "row", alignItems: "center" },
  search: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(4),
    height: 44,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
  },
  searchWide: { flex: 1 },
  filterChips: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: theme.spacing(2),
  },
  filterChip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  filterChipActive: {
    backgroundColor: theme.colors.text,
    borderColor: theme.colors.text,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.muted,
  },
  filterChipTextActive: { color: theme.colors.inverseText },
  courseProgressTrack: {
    height: 4,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  courseProgressFill: {
    height: 4,
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.full,
  },
  lockBox: { gap: theme.spacing(1) },
})
