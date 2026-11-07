import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import { CourseLessonRow } from "./CourseLessonRow"
import { LockBadge } from "./LockBadge"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { errorMessage } from "../../shared/error-message"
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { cacheCourse, getCachedCourse } from "../offline/offline-store"
import type { BulkDownloadTarget } from "../offline/bulk-download"
import { BulkDownloadPanel } from "../offline/BulkDownloadPanel"
import {
  useBulkDownload,
  type BulkDownloadCopy,
} from "../offline/use-bulk-download"
import { useFocusEffect } from "@react-navigation/native"
import {
  getCourseProgressSummary,
  getProgressMap,
  markCompleted,
  unmarkCompleted,
  type ProgressStatus,
} from "../video/playback-progress"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "CourseDetail">

const COURSE_BULK_COPY: BulkDownloadCopy = {
  confirmTitle: "Скачать весь курс?",
  allDoneTitle: "Курс уже скачан",
  allDoneMessage: "Все доступные видео уже в загруженном.",
}

type VideoProgressRow = {
  status: ProgressStatus["status"]
  ratio: number
}

const computeRow = (
  entry: { position: number; completed?: boolean } | undefined,
  duration?: number | null,
): VideoProgressRow | null => {
  if (!entry) return null
  if (entry.completed) return { status: "watched", ratio: 1 }
  if (entry.position <= 0) return null
  const ratio =
    duration && duration > 0 ? Math.min(entry.position / duration, 1) : 0
  if (ratio >= 0.9) return { status: "watched", ratio: 1 }
  return { status: "in-progress", ratio }
}


export function CourseDetailScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  const [filter, setFilter] = useState<
    "all" | "unwatched" | "in-progress"
  >("all")
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
  const [progressByVideo, setProgressByVideo] = useState<
    Record<string, VideoProgressRow>
  >({})
  const [courseProgress, setCourseProgress] = useState<{
    watched: number
    total: number
  }>({ watched: 0, total: 0 })

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

  useFocusEffect(
    useCallback(() => {
      if (!course) return
      void (async () => {
        const map = await getProgressMap()
        const byVideo: Record<string, VideoProgressRow> = {}
        for (const v of course.videos) {
          const row = computeRow(map[v.id], v.duration)
          if (row) byVideo[v.id] = row
        }
        setProgressByVideo(byVideo)
        const summary = await getCourseProgressSummary({
          videos: course.videos.map((v) => ({
            id: v.id,
            duration: v.duration,
          })),
        })
        setCourseProgress(summary)
      })()
    }, [course]),
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadCourse()
    setRefreshing(false)
  }

  const refreshProgress = useCallback(async () => {
    if (!course) return
    const map = await getProgressMap()
    const byVideo: Record<string, VideoProgressRow> = {}
    for (const v of course.videos) {
      const row = computeRow(map[v.id], v.duration)
      if (row) byVideo[v.id] = row
    }
    setProgressByVideo(byVideo)
    const summary = await getCourseProgressSummary({
      videos: course.videos.map((v) => ({ id: v.id, duration: v.duration })),
    })
    setCourseProgress(summary)
  }, [course])

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

  const filteredVideos = useMemo(() => {
    if (!course) return []
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
  }, [course, query, filter, progressByVideo])

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
            <View style={styles.metaLine}>
              <Text style={styles.muted}>Уроков: {course.videos.length}</Text>
              {courseProgress.total > 0 && (
                <Text style={styles.progressBadge}>
                  Просмотрено {courseProgress.watched}/{courseProgress.total}
                </Text>
              )}
              {isOfflineSource && (
                <Text style={[styles.muted, styles.offlineMark]}>офлайн</Text>
              )}
            </View>
            {courseProgress.total > 0 && (
              <View style={styles.courseProgressTrack}>
                <View
                  style={[
                    styles.courseProgressFill,
                    {
                      width: `${
                        (courseProgress.watched / courseProgress.total) * 100
                      }%`,
                    },
                  ]}
                />
              </View>
            )}

            {offlineDownloads && !course.lock && (
              <BulkDownloadPanel
                bulk={bulk}
                label="Скачать весь курс"
                allDownloadedLabel="Курс уже загружен"
                disabled={isOfflineSource}
              />
            )}

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск по урокам"
              placeholderTextColor={theme.colors.muted}
              style={styles.search}
              autoCorrect={false}
              clearButtonMode="while-editing"
              onLayout={(e) => {
                searchY.current = e.nativeEvent.layout.y
              }}
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
              {(
                [
                  { key: "all", label: "Все" },
                  { key: "unwatched", label: "Непросмотренные" },
                  { key: "in-progress", label: "В процессе" },
                ] as const
              ).map((option) => {
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
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>
              {query.trim()
                ? "Ничего не найдено."
                : "В этом курсе пока нет видео."}
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
              index={index}
              offline={offline}
              progress={progress}
              showChapterHeader={showChapterHeader}
              onPress={() => {
                if (item.lock) {
                  showAlert("Урок пока закрыт", item.lock.reason)
                  return
                }
                navigation.navigate("Video", {
                  videoId: item.id,
                  courseId: course.id,
                  title: item.title,
                })
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
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: {
    padding: theme.spacing(5),
    paddingTop: theme.spacing(4),
    gap: theme.spacing(2),
  },
  header: { gap: theme.spacing(2), marginBottom: theme.spacing(4) },
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
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    marginTop: theme.spacing(1),
  },
  muted: { ...theme.typography.caption },
  offlineMark: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted,
    overflow: "hidden",
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  search: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(4),
    height: 44,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
    marginTop: theme.spacing(3),
  },
  filterChips: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: theme.spacing(2),
    flexWrap: "wrap",
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
  progressBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.success,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.successSoft,
    overflow: "hidden",
  },
  courseProgressTrack: {
    height: 6,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    overflow: "hidden",
    marginTop: theme.spacing(2),
  },
  courseProgressFill: {
    height: 6,
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.full,
  },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
  lockBox: { gap: theme.spacing(1) },
})
