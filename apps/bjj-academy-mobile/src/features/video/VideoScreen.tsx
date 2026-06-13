import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useVideoPlayer, VideoView } from "expo-video"

import { SubtitleOverlay } from "./subtitle-overlay"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
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
  canDownloadNow,
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
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Video">

type DownloadState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "downloading"; progress: number; phase: string }
  | { status: "ready" }
  | { status: "error"; message: string }

const formatPosition = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

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
  const [note, setNoteText] = useState("")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
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

    const readDuration = (): number | undefined => {
      try {
        const d = (player as { duration?: number }).duration
        return typeof d === "number" && d > 0 ? d : undefined
      } catch {
        return undefined
      }
    }

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
      try {
        const t = (player as { currentTime?: number }).currentTime
        const d = readDuration() ?? video?.duration ?? null
        if (typeof t === "number" && t > 0) {
          if (d && t > d - 5) {
            // We treat "within 5 seconds of the end" as a finished lesson;
            // playToEnd may not fire if the user closes the screen first.
            void markCompleted(videoId, d)
          } else {
            void saveProgress(videoId, t, readDuration())
          }
        }
      } catch {
        /* noop */
      }
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
      console.log("[VideoScreen] mount videoId=", videoId, "courseId=", courseId)
      const local = await getOfflineManifestUri(videoId)
      console.log("[VideoScreen] offline manifest=", local)

      try {
        console.log("[VideoScreen] -> getVideo")
        const videoData = await getVideo({
          workspaceId: workspace.workspaceId,
          videoId,
        })
        console.log("[VideoScreen] <- getVideo title=", videoData.title)
        if (cancelled) return
        setVideo(videoData)
        navigation.setOptions({ title: videoData.title })

        if (courseId) {
          console.log("[VideoScreen] -> getCourse")
          const courseData = await getCourse({
            workspaceId: workspace.workspaceId,
            courseId,
          })
          console.log("[VideoScreen] <- getCourse")
          if (cancelled) return
          setCourse(courseData)
          void cacheCourse(courseData)
        }

        if (local) {
          setOfflineUri(local)
          setIsOfflineSource(true)
          setDownload({ status: "ready" })
        } else {
          setDownload({ status: "absent" })
          console.log("[VideoScreen] -> getVideoPlayback")
          const playback = await getVideoPlayback({ videoId })
          console.log("[VideoScreen] <- getVideoPlayback hlsUrl=", playback.hlsUrl)
          if (cancelled) return
          setStreamingUrl(playback.hlsUrl)
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
      setDownload({
        status: "error",
        message: networkPolicyMessage(policy.reason),
      })
      return
    }
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
  }

  const handleRemoveBookmark = async (id: string) => {
    await removeBookmark(videoId, id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
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
          <Pressable onPress={cyclePlaybackRate} style={styles.iconAction}>
            <Text style={styles.iconActionText}>{playbackRate}x</Text>
          </Pressable>
          <DrillModeButton style={styles.iconAction} />
          <Pressable onPress={handleShare} style={styles.iconAction}>
            <Text style={styles.iconActionText}>Поделиться</Text>
          </Pressable>
        </View>

        <View style={styles.loopBlock}>
          <View style={styles.loopHeader}>
            <Text style={styles.noteLabel}>A–B повтор</Text>
            {(loopA != null || loopB != null) && (
              <Pressable onPress={handleClearLoop} hitSlop={8}>
                <Text style={styles.loopClear}>Сброс</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.loopRow}>
            <Pressable onPress={handleSetLoopA} style={styles.loopButton}>
              <Text style={styles.loopButtonLabel}>A</Text>
              <Text style={styles.loopButtonValue}>
                {loopA != null ? formatPosition(loopA) : "—"}
              </Text>
            </Pressable>
            <Pressable onPress={handleSetLoopB} style={styles.loopButton}>
              <Text style={styles.loopButtonLabel}>B</Text>
              <Text style={styles.loopButtonValue}>
                {loopB != null ? formatPosition(loopB) : "—"}
              </Text>
            </Pressable>
          </View>
          {loopA != null && loopB != null && (
            <Text style={styles.loopHint}>
              Отрезок зациклен. Снимите отметку, чтобы выключить.
            </Text>
          )}
        </View>

        {video?.subtitles && video.subtitles.length > 0 && (
          <View style={styles.bookmarksBlock}>
            <Text style={styles.noteLabel}>Субтитры</Text>
            <View style={styles.subtitleRow}>
              <Pressable
                onPress={() => setActiveSubtitleId(null)}
                style={[
                  styles.subtitleChip,
                  activeSubtitleId === null && styles.subtitleChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.subtitleChipText,
                    activeSubtitleId === null &&
                      styles.subtitleChipTextActive,
                  ]}
                >
                  Off
                </Text>
              </Pressable>
              {video.subtitles.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setActiveSubtitleId(s.id)}
                  style={[
                    styles.subtitleChip,
                    activeSubtitleId === s.id && styles.subtitleChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.subtitleChipText,
                      activeSubtitleId === s.id &&
                        styles.subtitleChipTextActive,
                    ]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {video?.timestamps && video.timestamps.length > 0 && (
          <View style={styles.bookmarksBlock}>
            <Text style={styles.noteLabel}>Главы</Text>
            <View style={styles.bookmarkList}>
              {video.timestamps.map((ts) => (
                <Pressable
                  key={ts.id}
                  onPress={() => seekTo(ts.positionSec)}
                  style={styles.bookmarkRow}
                >
                  <View style={styles.bookmarkTime}>
                    <Text style={styles.bookmarkTimeText}>
                      {formatPosition(ts.positionSec)}
                    </Text>
                  </View>
                  <Text style={styles.bookmarkLabel} numberOfLines={1}>
                    {ts.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={styles.bookmarksBlock}>
          <View style={styles.bookmarksHeader}>
            <Text style={styles.noteLabel}>Закладки</Text>
            <Pressable onPress={handleAddBookmark} style={styles.addBookmarkButton}>
              <Text style={styles.addBookmarkText}>+ Добавить</Text>
            </Pressable>
          </View>
          {bookmarks.length === 0 ? (
            <Text style={styles.muted}>
              Нажмите «Добавить» в нужный момент — вернётесь сюда одним тапом.
            </Text>
          ) : (
            <View style={styles.bookmarkList}>
              {bookmarks.map((b) => (
                <View key={b.id} style={styles.bookmarkRow}>
                  <Pressable
                    onPress={() => seekTo(b.position)}
                    style={styles.bookmarkTime}
                  >
                    <Text style={styles.bookmarkTimeText}>
                      {formatPosition(b.position)}
                    </Text>
                  </Pressable>
                  <Text style={styles.bookmarkLabel} numberOfLines={1}>
                    {b.label || "Без подписи"}
                  </Text>
                  <Pressable
                    onPress={() => void handleRemoveBookmark(b.id)}
                    hitSlop={8}
                    style={styles.bookmarkRemove}
                  >
                    <Text style={styles.bookmarkRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel}>Личные заметки</Text>
          <TextInput
            value={note}
            onChangeText={handleNoteChange}
            placeholder="Например: пробовал на спарринге, заходит на open guard"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={styles.noteInput}
            textAlignVertical="top"
          />
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

        {nextId && course && (
          <Pressable
            onPress={() =>
              navigation.replace("Video", {
                videoId: nextId,
                courseId: course?.id,
                title: course?.videos[currentIndex + 1]?.title,
              })
            }
            style={({ pressed }) => [
              styles.upNextCard,
              pressed && styles.buttonPressed,
            ]}
          >
            <View style={styles.upNextThumb}>
              {course.videos[currentIndex + 1]?.thumbnailUrl ? (
                <Image
                  source={{
                    uri: course.videos[currentIndex + 1].thumbnailUrl ?? undefined,
                  }}
                  style={styles.upNextImage}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.upNextThumbPlaceholder}>
                  №{currentIndex + 2}
                </Text>
              )}
            </View>
            <View style={styles.upNextBody}>
              <Text style={styles.upNextLabel}>Следующее</Text>
              <Text style={styles.upNextTitle} numberOfLines={2}>
                {course.videos[currentIndex + 1]?.title}
              </Text>
            </View>
            <Text style={styles.upNextArrow}>→</Text>
          </Pressable>
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
  loopBlock: {
    gap: theme.spacing(2),
    padding: theme.spacing(3),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  loopHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  loopClear: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.muted,
  },
  loopRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
  },
  loopButton: {
    flex: 1,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    gap: 2,
  },
  loopButtonLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted,
    letterSpacing: 0.5,
  },
  loopButtonValue: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  loopHint: {
    ...theme.typography.caption,
  },
  bookmarksBlock: { gap: theme.spacing(2) },
  subtitleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(1) + 2,
  },
  subtitleChip: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  subtitleChipActive: { backgroundColor: theme.colors.accent },
  subtitleChipText: { color: theme.colors.text, fontSize: 13 },
  subtitleChipTextActive: { color: "#fff", fontWeight: "600" },
  bookmarksHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addBookmarkButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  addBookmarkText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.text,
  },
  bookmarkList: { gap: theme.spacing(1) + 2 },
  bookmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(1) + 2,
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceMuted,
  },
  bookmarkTime: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bookmarkTimeText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.accent,
    fontVariant: ["tabular-nums"],
  },
  bookmarkLabel: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
  },
  bookmarkRemove: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
  },
  bookmarkRemoveText: {
    fontSize: 16,
    color: theme.colors.muted,
  },
  noteBlock: { gap: theme.spacing(2) },
  noteLabel: { ...theme.typography.label },
  noteInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing(3),
    minHeight: 84,
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
    lineHeight: 20,
  },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(4),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing(2),
    ...theme.shadows.sm,
  },
  downloadProgress: { flex: 1, gap: theme.spacing(1) },
  downloadLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.text,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.full,
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
  buttonDisabled: { opacity: 0.5 },
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
  upNextCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    padding: theme.spacing(3),
    paddingRight: theme.spacing(4),
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  upNextThumb: {
    width: 88,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  upNextImage: { width: "100%", height: "100%" },
  upNextThumbPlaceholder: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.mutedFaint,
  },
  upNextBody: { flex: 1, gap: 2 },
  upNextLabel: { ...theme.typography.label },
  upNextTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  upNextArrow: {
    fontSize: 18,
    color: theme.colors.muted,
    fontWeight: "700",
  },
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
