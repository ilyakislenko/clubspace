import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useVideoPlayer, VideoView } from "expo-video"

import { SubtitleOverlay } from "./subtitle-overlay"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import {
  getOfflineDownload,
  getStreamingUri,
  getVideo,
  type VideoDetail,
} from "../../shared/api/videos"
import { useAuth } from "../../shared/auth-context"
import { errorMessage } from "../../shared/error-message"
import { brand } from "../../shared/brand"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  cacheCourse,
  downloadVideoForOffline,
  getCachedCourse,
  getCachedVideo,
  getOfflineVideoUri,
  removeOffline,
  type OfflineDownloadProgress,
} from "../offline/offline-store"
import {
  canDownloadNow,
  isOnline,
  networkPolicyMessage,
} from "../offline/network-policy"
import {
  addBookmark,
  type Bookmark,
  getNote,
  getPreferences,
  isFavorite,
  listBookmarks,
  recordRecent,
  removeBookmark,
  setNote,
  setPreferences,
  toggleFavorite,
  updateBookmarkLabel,
} from "../profile/preferences-store"
import {
  getProgressStatus,
  getResumePosition,
  markCompleted,
  saveProgress,
  unmarkCompleted,
  type ProgressStatus,
} from "./playback-progress"
import { DrillModeButton } from "./DrillMode"
import { VideoStudyTools } from "./VideoStudyTools"
import { VideoCourseNav } from "./VideoCourseNav"
import { VideoDownloadControls } from "./VideoDownloadControls"
import { VideoLoopControls } from "./VideoLoopControls"
import { VideoSubtitlePicker } from "./VideoSubtitlePicker"
import { useToast } from "../../shared/components/Toast"
import { haptics } from "../../shared/haptics"
import { supportsOfflineDownload } from "../../shared/platform"
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
    case "video":
      return p.total > 0
        ? `Загрузка ${Math.round((p.done / p.total) * 100)}%`
        : "Загрузка…"
    case "thumbnail":
      return "Превью…"
    case "done":
      return "Готово"
  }
}

export function VideoScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { videoId, courseId } = route.params
  const { workspace } = useAuth()
  const { showToast } = useToast()

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
  const [note, setNoteText] = useState("")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [justAddedBookmarkId, setJustAddedBookmarkId] = useState<string | null>(
    null,
  )
  // null = subtitles off. Auto-picks the track marked default once the
  // video loads so users don't have to tap through a menu just to see
  // captions in the language the coach picked as canonical.
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null)
  const subtitleAutoPickedRef = useRef(false)
  const [loopA, setLoopA] = useState<number | null>(null)
  const [loopB, setLoopB] = useState<number | null>(null)
  const loopRef = useRef<{ a: number | null; b: number | null }>({
    a: null,
    b: null,
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
    if (subtitleAutoPickedRef.current) return
    const tracks = video?.subtitles
    if (!tracks || tracks.length === 0) return
    subtitleAutoPickedRef.current = true
    const def = tracks.find((s) => s.isDefault) ?? tracks[0]
    setActiveSubtitleId(def.id)
  }, [video?.subtitles])

  const activeSubtitle = useMemo(() => {
    if (!activeSubtitleId || !video?.subtitles) return null
    return video.subtitles.find((s) => s.id === activeSubtitleId) ?? null
  }, [activeSubtitleId, video?.subtitles])

  const getCurrentTime = useCallback(() => {
    try {
      return (player as { currentTime?: number }).currentTime
    } catch {
      return undefined
    }
  }, [player])

  useEffect(() => {
    void getProgressStatus(videoId, video?.duration).then(setProgressStatus)
    void getNote(videoId).then(setNoteText)
    void listBookmarks(videoId).then(setBookmarks)
  }, [videoId, video?.duration])

  useEffect(() => {
    loopRef.current = { a: loopA, b: loopB }
  }, [loopA, loopB])

  useEffect(() => {
    void getPreferences().then((p) => setPlaybackRate(p.defaultPlaybackRate))
  }, [])

  useEffect(() => {
    if (!player) return
    try {
      ;(player as { playbackRate: number }).playbackRate = playbackRate
    } catch {
      /* expo-video versions vary in their playbackRate property */
    }
  }, [player, playbackRate, playableUri])

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
      const [resumeAt, prefs] = await Promise.all([
        getResumePosition(videoId, video?.duration),
        getPreferences(),
      ])
      if (cancelled || resumeAppliedRef.current) return
      try {
        if (resumeAt > 0) {
          ;(player as { currentTime: number }).currentTime = resumeAt
        }
      } catch {
        /* noop */
      }
      resumeAppliedRef.current = true
      // Honour the "Автовоспроизведение" setting: only auto-start when it's on.
      // When off, the source is loaded (and resume position applied) but the
      // user presses play themselves.
      if (prefs.autoplay) {
        try {
          player.play()
        } catch {
          /* noop */
        }
      }
    })()

    const readDuration = (): number | undefined => {
      try {
        const d = (player as { duration?: number }).duration
        return typeof d === "number" && d > 0 ? d : undefined
      } catch {
        return undefined
      }
    }

    // Persist the latest position; "within 5s of the end" counts as finished
    // (playToEnd may not fire if the user leaves first). Shared by the unmount
    // cleanup AND the background handler below — backgrounding the app doesn't
    // unmount the screen, so the cleanup alone would lose progress on an
    // OS-kill while suspended.
    const flushProgress = () => {
      try {
        const t = (player as { currentTime?: number }).currentTime
        const d = readDuration() ?? video?.duration ?? null
        if (typeof t === "number" && t > 0) {
          if (d && t > d - 5) {
            void markCompleted(videoId, d)
          } else {
            void saveProgress(videoId, t, readDuration())
          }
        }
      } catch {
        /* noop */
      }
    }

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        flushProgress()
      }
    })

    const interval = setInterval(() => {
      try {
        const t = (player as { currentTime?: number }).currentTime
        if (typeof t === "number" && t > 0) {
          void saveProgress(videoId, t, readDuration())
        }
      } catch {
        /* noop */
      }
    }, 5_000)

    // The player fires playToEnd once it reaches the actual end of the file —
    // this is the most reliable way to mark a lesson watched, since it works
    // even when Video.duration is missing in the backend.
    let endSubscription: { remove: () => void } | null = null
    try {
      endSubscription = (
        player as {
          addListener: (
            event: string,
            cb: () => void,
          ) => { remove: () => void }
        }
      ).addListener("playToEnd", () => {
        void markCompleted(videoId, readDuration())
      })
    } catch {
      /* expo-video addListener shape varies by version */
    }

    // A-B loop: poll the player and seek back to A when we cross B.
    const loopInterval = setInterval(() => {
      const { a, b } = loopRef.current
      if (a == null || b == null || b <= a) return
      try {
        const t = (player as { currentTime?: number }).currentTime
        if (typeof t === "number" && t >= b) {
          ;(player as { currentTime: number }).currentTime = a
        }
      } catch {
        /* noop */
      }
    }, 250)

    return () => {
      cancelled = true
      clearInterval(interval)
      clearInterval(loopInterval)
      endSubscription?.remove()
      appStateSub.remove()
      flushProgress()
    }
  }, [playableUri, player, videoId, video?.duration])

  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    setLoading(true)
    setError(null)

    // Slow / hung backend used to leave the user staring at a centred
    // spinner forever. We surface a "Повторить" path after 12 seconds.
    const timeout = setTimeout(() => {
      if (cancelled) return
      setError(
        "Долго не отвечает сервер. Проверьте интернет и попробуйте ещё раз.",
      )
      setLoading(false)
    }, 12_000)

    void (async () => {
      const local = await getOfflineVideoUri(videoId)

      try {
        const videoData = await getVideo({
          workspaceId: workspace.workspaceId,
          videoId,
        })
        if (cancelled) return
        setVideo(videoData)
        navigation.setOptions({ title: videoData.title })

        if (courseId) {
          const courseData = await getCourse({
            workspaceId: workspace.workspaceId,
            courseId,
          })
          if (cancelled) return
          setCourse(courseData)
          void cacheCourse(courseData)
        }

        // Download status reflects whether a local copy exists, independent of
        // which source we actually play below.
        setDownload({ status: local ? "ready" : "absent" })

        // Prefer streaming whenever we're online: a downloaded HLS playlist
        // cannot be played from a local file:// on iOS (AVPlayer limitation),
        // and the stream is always fresher. The local copy is used only when
        // we're truly offline, or when streaming fails (handled in catch).
        if (local && !(await isOnline())) {
          if (cancelled) return
          setOfflineUri(local)
          setIsOfflineSource(true)
        } else {
          const uri = await getStreamingUri({ videoId })
          if (cancelled) return
          setStreamingUrl(uri)
          setIsOfflineSource(false)
        }
        if (cancelled) return
        // Clear any error the 12s watchdog set if the load actually came back
        // (late success) — otherwise the error screen stays up over a video
        // that loaded fine.
        setError(null)
      } catch (err) {
        console.warn("[VideoScreen] error:", err instanceof Error ? err.message : err)
        if (cancelled) return
        // Network failure or auth: try to fall back to cached metadata.
        const cached = await getCachedVideo(videoId)
        // Re-check after the await: a retry (retryNonce) or workspace change
        // may have superseded this run, and a late cache fallback must not
        // clobber the fresh run's state (the try-path guards every await the
        // same way).
        if (cancelled) return
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
          setOfflineUri(cached.videoUri)
          setIsOfflineSource(true)
          setDownload({ status: "ready" })
        } else {
          setError(
            errorMessage(err, "Не удалось загрузить видео."),
          )
        }
      } finally {
        if (!cancelled) {
          clearTimeout(timeout)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [workspace, videoId, courseId, navigation, retryNonce])

  const handleRetry = () => {
    setRetryNonce((n) => n + 1)
  }

  const handleDownload = async () => {
    if (!video) return
    const policy = await canDownloadNow()
    if (!policy.ok) {
      const message = networkPolicyMessage(policy.reason)
      setDownload({ status: "error", message })
      haptics.warning()
      showToast(message, "error")
      return
    }
    setDownload({ status: "downloading", progress: 0, phase: "Подготовка…" })
    try {
      const { url } = await getOfflineDownload({ videoId })
      await downloadVideoForOffline({
        videoId,
        downloadUrl: url,
        video,
        course: course ?? undefined,
        thumbnailUrl: video.thumbnailUrl,
        onProgress: (p) => {
          const progress =
            p.phase === "video" ? p.done / Math.max(p.total, 1) : 0
          setDownload({
            status: "downloading",
            progress,
            phase: phaseLabel(p),
          })
        },
      })
      const local = await getOfflineVideoUri(videoId)
      // Downloading just makes the video available offline — it must NOT yank
      // the player off the currently-playing stream onto the local copy (which
      // iOS can't play from file://). Only adopt the local source if nothing is
      // streaming (i.e. we're offline).
      if (local && !streamingUrl) {
        setOfflineUri(local)
        setIsOfflineSource(true)
      }
      setDownload({ status: "ready" })
      haptics.success()
      showToast("Скачано — доступно офлайн", "success")
    } catch (err) {
      const message = errorMessage(err, "Не удалось скачать.")
      setDownload({ status: "error", message })
      haptics.warning()
      showToast(message, "error")
    }
  }

  const handleRemoveOffline = async () => {
    await removeOffline(videoId)
    setOfflineUri(null)
    setIsOfflineSource(false)
    // If the video was opened from offline we never fetched a streaming URL,
    // so dropping the offline source would leave the player with nothing to
    // play until the screen is reopened. Fetch playback so the user can keep
    // watching online (best-effort: if offline/unauthorized, just clear it).
    if (!streamingUrl) {
      try {
        setStreamingUrl(await getStreamingUri({ videoId }))
      } catch {
        /* no network / not ready — player stays empty, expected when offline */
      }
    }
    setDownload({ status: "absent" })
    showToast("Удалено из загруженного")
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
    haptics.light()
    showToast(next ? "Добавлено в избранное" : "Убрано из избранного")
  }

  const handleToggleWatched = async () => {
    const wasWatched = progressStatus.status === "watched"
    if (wasWatched) {
      await unmarkCompleted(videoId)
    } else {
      await markCompleted(videoId)
    }
    const next = await getProgressStatus(videoId, video?.duration)
    setProgressStatus(next)
    haptics.light()
    showToast(
      wasWatched ? "Отметка о просмотре снята" : "Отмечено как просмотренное",
      wasWatched ? "default" : "success",
    )
  }

  const cyclePlaybackRate = async () => {
    const rates = [1, 1.25, 1.5, 2, 0.5, 0.75]
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length] ?? 1
    setPlaybackRate(next)
    await setPreferences({ defaultPlaybackRate: next })
  }

  const handleNoteChange = async (text: string) => {
    setNoteText(text)
    await setNote(videoId, text)
  }

  const readPlayerTime = (): number => {
    try {
      const t = (player as { currentTime?: number }).currentTime
      return typeof t === "number" && t >= 0 ? t : 0
    } catch {
      return 0
    }
  }

  const seekTo = (position: number) => {
    try {
      ;(player as { currentTime: number }).currentTime = Math.max(0, position)
      player.play()
    } catch {
      /* noop */
    }
  }

  const handleAddBookmark = async () => {
    const position = readPlayerTime()
    const created = await addBookmark(videoId, position)
    setBookmarks((prev) =>
      [...prev, created].sort((a, b) => a.position - b.position),
    )
    setJustAddedBookmarkId(created.id)
    haptics.light()
    showToast("Закладка добавлена")
  }

  const handleRemoveBookmark = async (id: string) => {
    await removeBookmark(videoId, id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }

  const handleRenameBookmark = async (id: string, label: string) => {
    await updateBookmarkLabel(videoId, id, label)
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, label } : b)),
    )
    setJustAddedBookmarkId(null)
  }

  const handleSetLoopA = () => {
    const t = readPlayerTime()
    setLoopA(t)
    if (loopB != null && loopB <= t) setLoopB(null)
  }

  const handleSetLoopB = () => {
    const t = readPlayerTime()
    if (loopA != null && t > loopA) {
      setLoopB(t)
    } else {
      Alert.alert("Сначала отметьте точку A раньше точки B.")
    }
  }

  const handleClearLoop = () => {
    setLoopA(null)
    setLoopB(null)
  }

  const handleConfirmRemoveOffline = () => {
    Alert.alert("Удалить из загруженного?", video?.title ?? "", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: handleRemoveOffline },
    ])
  }

  if (loading || error || !video) {
    const fallbackTitle = route.params.title ?? "Загружаем видео…"
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        <View style={styles.playerWrap}>
          <View style={[styles.player, styles.playerPlaceholder]}>
            {error ? (
              <Text style={styles.muted}>—</Text>
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{fallbackTitle}</Text>
          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>Повторить</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Назад</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>
              Готовим плеер. Если интернет нестабильный — подождите
              немного.
            </Text>
          )}
        </View>
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

  // The "Отметить просмотренным" chip becomes a primary CTA once the user
  // has watched more than half — that's the moment skipping the outro
  // becomes a reasonable decision worth surfacing.
  const lessonWatched = progressStatus.status === "watched"
  const markWatchedAsPrimary = !lessonWatched && progressStatus.ratio > 0.5

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.playerWrap}>
        {playableUri ? (
          <>
            <VideoView
              player={player}
              style={styles.player}
              contentFit="contain"
            />
            {activeSubtitle && (
              <SubtitleOverlay
                url={activeSubtitle.publicUrl}
                getCurrentTime={getCurrentTime}
              />
            )}
          </>
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
            accessibilityRole="button"
            accessibilityLabel={favorite ? "Убрать из избранного" : "В избранное"}
            accessibilityState={{ selected: favorite }}
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
          <Pressable
            onPress={handleToggleWatched}
            accessibilityRole="button"
            accessibilityLabel={
              lessonWatched
                ? "Снять отметку о просмотре"
                : "Отметить просмотренным"
            }
            accessibilityState={{ selected: lessonWatched }}
            style={[
              styles.iconAction,
              markWatchedAsPrimary && styles.iconActionPrimary,
            ]}
          >
            <Text
              style={[
                styles.iconActionText,
                markWatchedAsPrimary && styles.iconActionTextPrimary,
              ]}
            >
              {lessonWatched ? "✓ Посмотрено" : "Отметить просмотренным"}
            </Text>
          </Pressable>
          <Pressable
            onPress={cyclePlaybackRate}
            accessibilityRole="button"
            accessibilityLabel={`Скорость воспроизведения ${playbackRate}x, сменить`}
            style={styles.iconAction}
          >
            <Text style={styles.iconActionText}>{playbackRate}x</Text>
          </Pressable>
          <DrillModeButton style={styles.iconAction} />
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Поделиться"
            style={styles.iconAction}
          >
            <Text style={styles.iconActionText}>Поделиться</Text>
          </Pressable>
        </View>

        <VideoLoopControls
          loopA={loopA}
          loopB={loopB}
          onSetA={handleSetLoopA}
          onSetB={handleSetLoopB}
          onClear={handleClearLoop}
        />

        <VideoSubtitlePicker
          subtitles={video?.subtitles ?? []}
          activeId={activeSubtitleId}
          onSelect={setActiveSubtitleId}
        />

        <VideoStudyTools
          timestamps={video?.timestamps}
          bookmarks={bookmarks}
          note={note}
          onSeek={seekTo}
          onAddBookmark={handleAddBookmark}
          onRemoveBookmark={(id) => void handleRemoveBookmark(id)}
          onRenameBookmark={(id, label) =>
            void handleRenameBookmark(id, label)
          }
          justAddedBookmarkId={justAddedBookmarkId}
          onNoteChange={handleNoteChange}
        />

        {supportsOfflineDownload && (
          <VideoDownloadControls
            download={download}
            canDownload={!!streamingUrl}
            onDownload={handleDownload}
            onRemoveOffline={handleConfirmRemoveOffline}
          />
        )}

        <VideoCourseNav
          videos={course?.videos ?? []}
          currentIndex={currentIndex}
          prevId={prevId}
          nextId={nextId}
          onNavigate={(videoId, title) =>
            navigation.replace("Video", {
              videoId,
              courseId: course?.id,
              title,
            })
          }
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  playerWrap: { backgroundColor: theme.colors.playerBg, aspectRatio: 16 / 9 },
  player: { width: "100%", height: "100%" },
  playerPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(4),
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing(3),
  },
  title: {
    flex: 1,
    ...theme.typography.heading,
    fontSize: 22,
    color: theme.colors.text,
  },
  favoriteButton: {
    paddingHorizontal: theme.spacing(1),
    paddingTop: 2,
  },
  favoriteIcon: {
    fontSize: 28,
    color: theme.colors.mutedFaint,
    lineHeight: 28,
  },
  description: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  muted: { ...theme.typography.caption },
  offlineBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: 5,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.successSoft,
  },
  offlineBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.success,
    letterSpacing: 0.2,
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  iconAction: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconActionPrimary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  iconActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.text,
  },
  iconActionTextPrimary: {
    color: theme.colors.accentText,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    ...theme.shadows.sm,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  secondaryButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: "center" },
})
