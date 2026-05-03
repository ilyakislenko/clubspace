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

import {
  getCourse,
  type CourseDetail,
  type CourseVideo,
} from "../../shared/api/courses"
import { getVideo, getVideoPlayback } from "../../shared/api/videos"
import { useAuth } from "../../shared/auth-context"
import { theme } from "../../shared/theme"
import {
  cacheCourse,
  downloadVideoForOffline,
  getCachedCourse,
  listOfflineEntries,
  type OfflineDownloadProgress,
} from "../offline/offline-store"
import {
  canDownloadNow,
  networkPolicyMessage,
} from "../offline/network-policy"
import { useFocusEffect } from "@react-navigation/native"
import {
  getCourseProgressSummary,
  getProgressMap,
  type ProgressStatus,
} from "../video/playback-progress"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "CourseDetail">

const formatDuration = (seconds?: number | null): string | null => {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, "0")}`
}

type BulkDownloadState =
  | { status: "idle" }
  | {
      status: "downloading"
      currentIndex: number
      totalVideos: number
      videoPhase: string
    }
  | { status: "done"; downloaded: number; skipped: number }
  | { status: "error"; message: string }

const phaseLabel = (p: OfflineDownloadProgress): string => {
  switch (p.phase) {
    case "manifest":
      return "манифест"
    case "segments":
      return `сегмент ${p.done}/${p.total}`
    case "thumbnail":
      return "превью"
    case "done":
      return "готово"
  }
}

type VideoProgressRow = ProgressStatus["status"]

const isNewVideo = (createdAt?: string): boolean => {
  if (!createdAt) return false
  const ageMs = Date.now() - new Date(createdAt).getTime()
  return ageMs < 7 * 24 * 60 * 60 * 1000
}

export function CourseDetailScreen({ route, navigation }: Props) {
  const { courseId } = route.params
  const { workspace } = useAuth()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [offlineSet, setOfflineSet] = useState<Set<string>>(new Set())
  const [bulkState, setBulkState] = useState<BulkDownloadState>({
    status: "idle",
  })
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
          err instanceof Error ? err.message : "Не удалось загрузить курс.",
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

  useEffect(() => {
    void (async () => {
      const list = await listOfflineEntries()
      setOfflineSet(new Set(list.map((e) => e.videoId)))
    })()
  }, [course])

  useFocusEffect(
    useCallback(() => {
      if (!course) return
      void (async () => {
        const map = await getProgressMap()
        const byVideo: Record<string, VideoProgressRow> = {}
        for (const v of course.videos) {
          const e = map[v.id]
          if (!e) continue
          if (
            e.completed ||
            (v.duration && v.duration > 0 && e.position / v.duration >= 0.9)
          ) {
            byVideo[v.id] = "watched"
          } else if (e.position > 0) {
            byVideo[v.id] = "in-progress"
          }
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

  const filteredVideos = useMemo(() => {
    if (!course) return []
    const q = query.trim().toLowerCase()
    if (!q) return course.videos
    return course.videos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        (v.description ?? "").toLowerCase().includes(q),
    )
  }, [course, query])

  const handleBulkDownload = async () => {
    if (!course || !workspace) return
    const policy = await canDownloadNow()
    if (!policy.ok) {
      Alert.alert("Загрузка недоступна", networkPolicyMessage(policy.reason))
      return
    }
    const missing = course.videos.filter(
      (v) => v.status === "ready" && !offlineSet.has(v.id),
    )
    if (missing.length === 0) {
      Alert.alert("Курс уже скачан", "Все доступные видео уже в загруженном.")
      return
    }
    Alert.alert(
      "Скачать весь курс?",
      `Будет скачано видео: ${missing.length}. Это может занять время и место на устройстве.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Скачать",
          onPress: async () => {
            await runBulkDownload(missing)
          },
        },
      ],
    )
  }

  const runBulkDownload = async (videos: CourseVideo[]) => {
    if (!course || !workspace) return
    let downloaded = 0
    let skipped = 0
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i]
      setBulkState({
        status: "downloading",
        currentIndex: i,
        totalVideos: videos.length,
        videoPhase: "подготовка",
      })
      try {
        const [videoDetail, playback] = await Promise.all([
          getVideo({
            workspaceId: workspace.workspaceId,
            videoId: v.id,
          }),
          getVideoPlayback({ videoId: v.id }),
        ])
        await downloadVideoForOffline({
          videoId: v.id,
          manifestUrl: playback.hlsUrl,
          video: videoDetail,
          course,
          thumbnailUrl: v.thumbnailUrl,
          onProgress: (p) =>
            setBulkState({
              status: "downloading",
              currentIndex: i,
              totalVideos: videos.length,
              videoPhase: phaseLabel(p),
            }),
        })
        downloaded += 1
        setOfflineSet((prev) => new Set(prev).add(v.id))
      } catch {
        skipped += 1
      }
    }
    setBulkState({ status: "done", downloaded, skipped })
    setTimeout(() => setBulkState({ status: "idle" }), 4_000)
  }

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
        <Text style={styles.errorText}>{error ?? "Курс не найден."}</Text>
      </SafeAreaView>
    )
  }

  const allReadyDownloaded =
    course.videos.filter((v) => v.status === "ready").length > 0 &&
    course.videos
      .filter((v) => v.status === "ready")
      .every((v) => offlineSet.has(v.id))

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <FlatList
        data={filteredVideos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{course.title}</Text>
            {course.description ? (
              <Text style={styles.description}>{course.description}</Text>
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

            <Pressable
              onPress={handleBulkDownload}
              disabled={
                bulkState.status === "downloading" ||
                allReadyDownloaded ||
                isOfflineSource
              }
              style={({ pressed }) => [
                styles.bulkButton,
                pressed && styles.buttonPressed,
                (bulkState.status === "downloading" ||
                  allReadyDownloaded ||
                  isOfflineSource) &&
                  styles.buttonDisabled,
              ]}
            >
              <Text style={styles.bulkButtonText}>
                {allReadyDownloaded
                  ? "Курс уже загружен"
                  : "Скачать весь курс"}
              </Text>
            </Pressable>

            {bulkState.status === "downloading" && (
              <View style={styles.bulkProgress}>
                <Text style={styles.muted}>
                  {bulkState.currentIndex + 1} из {bulkState.totalVideos} ·{" "}
                  {bulkState.videoPhase}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${
                          ((bulkState.currentIndex +
                            (bulkState.videoPhase === "готово" ? 1 : 0.5)) /
                            bulkState.totalVideos) *
                          100
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}
            {bulkState.status === "done" && (
              <Text style={[styles.muted, styles.bulkDone]}>
                Скачано: {bulkState.downloaded}, пропущено:{" "}
                {bulkState.skipped}
              </Text>
            )}

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск по урокам"
              placeholderTextColor={theme.colors.muted}
              style={styles.search}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
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
          const ready = item.status === "ready"
          const duration = formatDuration(item.duration)
          const offline = offlineSet.has(item.id)
          const progress = progressByVideo[item.id]
          const isNew = isNewVideo(
            (item as unknown as { createdAt?: string }).createdAt,
          )
          return (
            <Pressable
              onPress={() => {
                if (!ready && !offline) return
                navigation.navigate("Video", {
                  videoId: item.id,
                  courseId: course.id,
                  title: item.title,
                })
              }}
              disabled={!ready && !offline}
              style={({ pressed }) => [
                styles.row,
                !ready && !offline && styles.rowDisabled,
                pressed && (ready || offline) && styles.rowPressed,
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
                  <Text style={styles.thumbPlaceholder}>№{index + 1}</Text>
                )}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {progress === "watched" && (
                    <Text style={styles.watchedMark}>✓</Text>
                  )}
                  {offline && <Text style={styles.offlineDot}>●</Text>}
                </View>
                <View style={styles.rowMetaLine}>
                  <Text style={styles.rowMeta}>
                    Урок {index + 1}
                    {duration ? ` · ${duration}` : ""}
                    {!ready ? " · в обработке" : ""}
                  </Text>
                  {isNew && <Text style={styles.newBadge}>NEW</Text>}
                  {progress === "in-progress" && (
                    <Text style={styles.inProgressBadge}>в процессе</Text>
                  )}
                </View>
              </View>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: theme.spacing(4), gap: theme.spacing(2) },
  header: { gap: theme.spacing(2), marginBottom: theme.spacing(3) },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.text },
  description: { fontSize: 14, color: theme.colors.muted, lineHeight: 20 },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  muted: { fontSize: 12, color: theme.colors.muted },
  offlineMark: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontWeight: "600",
  },
  bulkButton: {
    backgroundColor: theme.colors.text,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: theme.spacing(2),
  },
  bulkButtonText: {
    color: theme.colors.accentText,
    fontSize: 14,
    fontWeight: "600",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  bulkProgress: { gap: theme.spacing(1) },
  progressTrack: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: theme.colors.accent },
  bulkDone: { marginTop: theme.spacing(1) },
  search: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    fontSize: 14,
    color: theme.colors.text,
    marginTop: theme.spacing(2),
  },
  row: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    marginBottom: theme.spacing(2),
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowDisabled: { opacity: 0.6 },
  rowPressed: { opacity: 0.85 },
  thumb: {
    width: 96,
    alignSelf: "stretch",
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.muted,
  },
  rowBody: { flex: 1, padding: theme.spacing(3), justifyContent: "center" },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: theme.spacing(1),
  },
  offlineDot: {
    fontSize: 10,
    color: theme.colors.success,
  },
  watchedMark: {
    fontSize: 14,
    color: theme.colors.success,
    fontWeight: "700",
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  rowMeta: { fontSize: 12, color: theme.colors.muted },
  newBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.colors.accentText,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(1),
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  inProgressBadge: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(1),
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  progressBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.success,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
    backgroundColor: "#dcfce7",
    overflow: "hidden",
  },
  courseProgressTrack: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: theme.spacing(1),
  },
  courseProgressFill: {
    height: 4,
    backgroundColor: theme.colors.success,
  },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
})
