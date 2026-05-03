import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useVideoPlayer, VideoView } from "expo-video"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import {
  getVideo,
  getVideoPlayback,
  type VideoDetail,
} from "../../shared/api/videos"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { theme } from "../../shared/theme"
import {
  cacheCourse,
  downloadVideoForOffline,
  getCachedCourse,
  getCachedVideo,
  getOfflineManifestUri,
  removeOffline,
  type OfflineDownloadProgress,
} from "../offline/offline-store"
import {
  isFavorite,
  recordRecent,
  toggleFavorite,
} from "../profile/preferences-store"
import {
  clearProgress,
  getProgressStatus,
  getResumePosition,
  markCompleted,
  saveProgress,
  unmarkCompleted,
  type ProgressStatus,
} from "./playback-progress"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Video">

type DownloadState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "downloading"; progress: number; phase: string }
  | { status: "ready" }
  | { status: "error"; message: string }

const phaseLabel = (p: OfflineDownloadProgress): string => {
  switch (p.phase) {
    case "manifest":
      return "Получаем манифест…"
    case "segments":
      return `Сегмент ${p.done} из ${p.total}`
    case "thumbnail":
      return "Превью…"
    case "done":
      return "Готово"
  }
}

export function VideoScreen({ route, navigation }: Props) {
  const { videoId, courseId } = route.params
  const { workspace } = useAuth()

  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [streamingUrl, setStreamingUrl] = useState<string | null>(null)
  const [offlineUri, setOfflineUri] = useState<string | null>(null)
  const [download, setDownload] = useState<DownloadState>({ status: "checking" })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOfflineSource, setIsOfflineSource] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>({
    status: "unwatched",
    position: 0,
    ratio: 0,
  })

  const playableUri = offlineUri ?? streamingUrl
  const resumeAppliedRef = useRef(false)

  const player = useVideoPlayer(playableUri ?? null, (instance) => {
    instance.loop = false
    instance.timeUpdateEventInterval = 1
  })

  useEffect(() => {
    void isFavorite(videoId).then(setFavorite)
  }, [videoId])

  useEffect(() => {
    void getProgressStatus(videoId, video?.duration).then(setProgressStatus)
  }, [videoId, video?.duration])

  useEffect(() => {
    if (!video) return
    void recordRecent({
      videoId,
      courseId: course?.id ?? courseId,
      title: video.title,
      thumbnailUrl: video.thumbnailUrl ?? null,
    })
  }, [video, videoId, courseId, course?.id])

  useEffect(() => {
    if (!playableUri || !player) return
    let cancelled = false
    resumeAppliedRef.current = false

    void (async () => {
      const resumeAt = await getResumePosition(videoId, video?.duration)
      if (cancelled || resumeAppliedRef.current) return
      try {
        if (resumeAt > 0) {
          ;(player as { currentTime: number }).currentTime = resumeAt
        }
      } catch {
        /* noop */
      }
      resumeAppliedRef.current = true
      try {
        player.play()
      } catch {
        /* noop */
      }
    })()

    const interval = setInterval(() => {
      try {
        const t = (player as { currentTime?: number }).currentTime
        if (typeof t === "number" && t > 0) {
          void saveProgress(videoId, t)
        }
      } catch {
        /* noop */
      }
    }, 5_000)

    return () => {
      cancelled = true
      clearInterval(interval)
      try {
        const t = (player as { currentTime?: number }).currentTime
        if (typeof t === "number" && t > 0) {
          if (video?.duration && t > video.duration - 5) {
            void clearProgress(videoId)
          } else {
            void saveProgress(videoId, t)
          }
        }
      } catch {
        /* noop */
      }
    }
  }, [playableUri, player, videoId, video?.duration])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      const local = await getOfflineManifestUri(videoId)

      try {
        const [videoData, courseData] = await Promise.all([
          getVideo({ workspaceId: workspace.workspaceId, videoId }),
          courseId
            ? getCourse({
                workspaceId: workspace.workspaceId,
                courseId,
              })
            : Promise.resolve(null),
        ])
        if (cancelled) return
        setVideo(videoData)
        setCourse(courseData)
        if (courseData) void cacheCourse(courseData)
        navigation.setOptions({ title: videoData.title })

        if (local) {
          setOfflineUri(local)
          setIsOfflineSource(true)
          setDownload({ status: "ready" })
        } else {
          setDownload({ status: "absent" })
          const playback = await getVideoPlayback({ videoId })
          if (cancelled) return
          setStreamingUrl(playback.hlsUrl)
        }
      } catch (err) {
        if (cancelled) return
        // Network failure or auth: try to fall back to cached metadata.
        const cached = await getCachedVideo(videoId)
        if (cached) {
          setVideo(cached.video)
          if (cached.course) {
            const cachedCourse = await getCachedCourse(cached.course.id)
            if (cachedCourse) setCourse(cachedCourse)
          } else if (courseId) {
            const cachedCourse = await getCachedCourse(courseId)
            if (cachedCourse) setCourse(cachedCourse)
          }
          navigation.setOptions({ title: cached.video.title })
          setOfflineUri(cached.manifestUri)
          setIsOfflineSource(true)
          setDownload({ status: "ready" })
        } else {
          setError(
            err instanceof Error ? err.message : "Не удалось загрузить видео.",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspace, videoId, courseId, navigation])

  const handleDownload = async () => {
    if (!video) return
    setDownload({ status: "downloading", progress: 0, phase: "Подготовка…" })
    try {
      const playback = streamingUrl
        ? { hlsUrl: streamingUrl }
        : await getVideoPlayback({ videoId })
      await downloadVideoForOffline({
        videoId,
        manifestUrl: playback.hlsUrl,
        video,
        course: course ?? undefined,
        thumbnailUrl: video.thumbnailUrl,
        onProgress: (p) => {
          const progress =
            p.phase === "segments" ? p.done / Math.max(p.total, 1) : 0
          setDownload({
            status: "downloading",
            progress,
            phase: phaseLabel(p),
          })
        },
      })
      const local = await getOfflineManifestUri(videoId)
      if (local) {
        setOfflineUri(local)
        setIsOfflineSource(true)
      }
      setDownload({ status: "ready" })
    } catch (err) {
      setDownload({
        status: "error",
        message: err instanceof Error ? err.message : "Не удалось скачать.",
      })
    }
  }

  const handleRemoveOffline = async () => {
    await removeOffline(videoId)
    setOfflineUri(null)
    setIsOfflineSource(false)
    setDownload({ status: "absent" })
  }

  const handleShare = async () => {
    if (!video) return
    try {
      await Share.share({
        title: video.title,
        message: `${video.title} — ${brand.displayName}`,
      })
    } catch {
      /* noop */
    }
  }

  const handleToggleFavorite = async () => {
    const next = await toggleFavorite(videoId)
    setFavorite(next)
  }

  const handleToggleWatched = async () => {
    if (progressStatus.status === "watched") {
      await unmarkCompleted(videoId)
    } else {
      await markCompleted(videoId)
    }
    const next = await getProgressStatus(videoId, video?.duration)
    setProgressStatus(next)
  }

  const handleConfirmRemoveOffline = () => {
    Alert.alert("Удалить из загруженного?", video?.title ?? "", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: handleRemoveOffline },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  if (error || !video) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>{error ?? "Видео не найдено."}</Text>
      </SafeAreaView>
    )
  }

  const currentIndex = course
    ? course.videos.findIndex((v) => v.id === videoId)
    : -1
  const prevId = course && currentIndex > 0 ? course.videos[currentIndex - 1].id : null
  const nextId =
    course && currentIndex >= 0 && currentIndex < course.videos.length - 1
      ? course.videos[currentIndex + 1].id
      : null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.playerWrap}>
        {playableUri ? (
          <VideoView
            player={player}
            style={styles.player}
            contentFit="contain"
          />
        ) : (
          <View style={[styles.player, styles.playerPlaceholder]}>
            <Text style={styles.muted}>Видео ещё не готово к просмотру.</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{video.title}</Text>
          <Pressable
            onPress={handleToggleFavorite}
            hitSlop={8}
            style={styles.favoriteButton}
          >
            <Text
              style={[
                styles.favoriteIcon,
                favorite && { color: theme.colors.accent },
              ]}
            >
              {favorite ? "★" : "☆"}
            </Text>
          </Pressable>
        </View>

        {isOfflineSource && (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>
              Воспроизведение из загруженного
            </Text>
          </View>
        )}

        {course && currentIndex >= 0 && (
          <Text style={styles.muted}>
            Урок {currentIndex + 1} из {course.videos.length}
          </Text>
        )}
        {video.description ? (
          <Text style={styles.description}>{video.description}</Text>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable onPress={handleToggleWatched} style={styles.iconAction}>
            <Text style={styles.iconActionText}>
              {progressStatus.status === "watched"
                ? "✓ Посмотрено"
                : "Отметить просмотренным"}
            </Text>
          </Pressable>
          <Pressable onPress={handleShare} style={styles.iconAction}>
            <Text style={styles.iconActionText}>Поделиться</Text>
          </Pressable>
        </View>

        <View style={styles.downloadRow}>
          {download.status === "ready" ? (
            <>
              <Text style={styles.downloadLabel}>✓ Скачано для офлайн</Text>
              <Pressable
                onPress={handleConfirmRemoveOffline}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Удалить</Text>
              </Pressable>
            </>
          ) : download.status === "downloading" ? (
            <>
              <View style={styles.downloadProgress}>
                <Text style={styles.downloadLabel}>
                  {download.phase}{" "}
                  {download.progress > 0 &&
                    `· ${Math.round(download.progress * 100)}%`}
                </Text>
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(download.progress * 100)}%` },
                    ]}
                  />
                </View>
              </View>
              <ActivityIndicator color={theme.colors.accent} />
            </>
          ) : (
            <>
              <Text style={styles.downloadLabel}>Доступ без интернета</Text>
              <Pressable
                onPress={handleDownload}
                disabled={!streamingUrl}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  !streamingUrl && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>Скачать</Text>
              </Pressable>
            </>
          )}
        </View>
        {download.status === "error" && (
          <Text style={styles.errorText}>{download.message}</Text>
        )}

        {(prevId || nextId) && (
          <View style={styles.navRow}>
            <Pressable
              disabled={!prevId}
              onPress={() =>
                prevId &&
                navigation.replace("Video", {
                  videoId: prevId,
                  courseId: course?.id,
                  title: course?.videos[currentIndex - 1]?.title,
                })
              }
              style={({ pressed }) => [
                styles.navButton,
                !prevId && styles.navButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.navText}>← Предыдущее</Text>
            </Pressable>
            <Pressable
              disabled={!nextId}
              onPress={() =>
                nextId &&
                navigation.replace("Video", {
                  videoId: nextId,
                  courseId: course?.id,
                  title: course?.videos[currentIndex + 1]?.title,
                })
              }
              style={({ pressed }) => [
                styles.navButton,
                !nextId && styles.navButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.navText}>Следующее →</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  playerWrap: { backgroundColor: "#000", aspectRatio: 16 / 9 },
  player: { width: "100%", height: "100%" },
  playerPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  body: { padding: theme.spacing(4), gap: theme.spacing(3) },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing(2),
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text,
  },
  favoriteButton: { paddingHorizontal: theme.spacing(1) },
  favoriteIcon: { fontSize: 28, color: theme.colors.muted, lineHeight: 28 },
  description: { fontSize: 14, color: theme.colors.text, lineHeight: 20 },
  muted: { fontSize: 12, color: theme.colors.muted },
  offlineBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  offlineBadgeText: { fontSize: 11, color: theme.colors.muted },
  actionsRow: { flexDirection: "row", gap: theme.spacing(2) },
  iconAction: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconActionText: { fontSize: 13, color: theme.colors.text },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing(2),
  },
  downloadProgress: { flex: 1, gap: theme.spacing(1) },
  downloadLabel: { fontSize: 14, color: theme.colors.text },
  progressBarTrack: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 4,
    backgroundColor: theme.colors.accent,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.sm,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontWeight: "600",
    fontSize: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: { color: theme.colors.text, fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
  navRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: theme.spacing(2),
  },
  navButton: {
    flex: 1,
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  navButtonDisabled: { opacity: 0.4 },
  navText: { fontSize: 13, color: theme.colors.text },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
})
