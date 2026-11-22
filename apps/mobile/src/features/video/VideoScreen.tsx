import { useFocusEffect } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useNetworkState } from "expo-network"
import { usePlayer } from "./use-player"

import { SubtitleOverlay } from "./subtitle-overlay"
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
  AppState,
  BackHandler,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native"
import { showAlert } from "../../shared/alert"
import { shareFeedback, shareText } from "../../shared/share"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet } from "../../shared/components/Sheet"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCourse, type CourseDetail } from "../../shared/api/courses"
import type {
  BookmarkDrawing,
  MyVideoBookmark,
} from "../../shared/api/video-study"
import {
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
  getOfflineVideoState,
  offlineDownloadControls,
  removeOffline,
} from "../offline/offline-store"
import {
  lostReasonMessage,
  OfflineDownloadInterrupted,
  type OfflineDownloadProgress,
  type OfflineVideoState,
} from "../offline/offline-types"
import { formatBytes } from "../offline/offline-budget"
import {
  canDownloadNow,
  isOnline,
  networkPolicyMessage,
} from "../offline/network-policy"
import {
  addBookmark,
  getNote,
  getPreferences,
  getSubtitleChoice,
  isFavorite,
  listBookmarks,
  recordRecent,
  removeBookmark,
  saveBookmarkDrawing,
  setNote,
  setSubtitleChoice,
  setPreferences,
  syncVideoStudy,
  toggleFavorite,
  updateBookmark,
} from "../profile/preferences-store"
import { segmentBounds } from "../profile/study-merge"
import {
  getProgressStatus,
  getResumePosition,
  markCompleted,
  saveProgress,
  unmarkCompleted,
  type ProgressStatus,
} from "./playback-progress"
import { chapterIndexAt } from "./chapter-nav"
import { choiceFromTrack, pickSubtitleTrack } from "./subtitle-choice"
import {
  downloadMenuActions,
  type DownloadAction,
  type DownloadState,
} from "./download-status"
import { buildMomentLink, momentShareText } from "./moment-link"
import { momentLinkBase } from "./pending-moment"
import type { ShownDrawing } from "./drawing-math"
import { formatClock, isDrillRunning, useDrill } from "./drill-context"
import { DrillModal } from "./DrillModal"
import { MenuOption, MoreButton } from "./MenuOption"
import { VideoStudyTools } from "./VideoStudyTools"
import { HoldToBoostArea } from "./HoldToBoostArea"
import { NextLessonCountdown } from "./NextLessonCountdown"
import type { StudyPlan } from "../../shared/api/study-plans"
import { AddToPlanModal } from "../study-plans/AddToPlanModal"
import { PlanBar, type PlanBarProps } from "../study-plans/PlanBar"
import {
  draftFromBookmark,
  draftFromChapter,
  draftFromMoment,
  type PlanItemDraft,
} from "../study-plans/plan-drafts"
import {
  adjacentPlayableIndex,
  planStep,
  reachedItemEnd,
  resolvePlanIndex,
} from "../study-plans/plan-playback"
import { loadStudyPlan } from "../study-plans/plan-store"
import { PlayerOverlay } from "./PlayerOverlay"
import { VideoCourseNav } from "./VideoCourseNav"
import { VideoDownloadStatus } from "./VideoDownloadStatus"
import { VideoLoopControls } from "./VideoLoopControls"
import { SubtitleMenuOptions } from "./VideoSubtitlePicker"
import { useToast } from "../../shared/components/Toast"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { haptics } from "../../shared/haptics"
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { useResponsive } from "../../shared/useResponsive"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Video">

// The progress line shows the percentage; the web store also reports bytes
// and the projected size (checked against the browser's quota).
const phaseLabel = (p: OfflineDownloadProgress): string => {
  switch (p.phase) {
    case "video":
      return p.bytes !== undefined && p.estimatedBytes !== undefined
        ? `Загрузка · ${formatBytes(p.bytes)} из ~${formatBytes(p.estimatedBytes)}`
        : "Загрузка"
    case "thumbnail":
      return "Превью…"
    case "done":
      return "Готово"
  }
}

const downloadingState = (p: OfflineDownloadProgress): DownloadState => ({
  status: "downloading",
  progress: p.phase === "video" ? p.done / Math.max(p.total, 1) : 1,
  phase: phaseLabel(p),
})

const downloadStateFrom = (local: OfflineVideoState): DownloadState => {
  switch (local.status) {
    case "absent":
      return { status: "absent" }
    case "ready":
      return {
        status: "ready",
        accessUntil: local.accessExpiresAt
          ? new Date(local.accessExpiresAt).toLocaleDateString("ru-RU")
          : undefined,
      }
    case "partial":
      return local.active
        ? { status: "downloading", progress: local.progress, phase: "Загрузка" }
        : { status: "paused", progress: local.progress }
    case "lost":
      return { status: "lost", message: lostReasonMessage(local.reason) }
  }
}

// A seconds route param. On web it arrives from the URL as a string.
const paramSeconds = (value: unknown): number | null => {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// After this long without edits, the lesson's notes/bookmarks are synced.
const STUDY_SYNC_DEBOUNCE_MS = 2_500
// How often the side panel re-checks which chapter is playing.
const CHAPTER_POLL_MS = 1_000
// How often a plan's segment item checks whether it reached its end.
const PLAN_END_POLL_MS = 250

export function VideoScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { isWide, height } = useResponsive()
  const { videoId, courseId } = route.params
  const { workspace } = useAuth()
  const offlineDownloads = useOfflineDownloadsAllowed()
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
  const [bookmarks, setBookmarks] = useState<MyVideoBookmark[]>([])
  const [justAddedBookmarkId, setJustAddedBookmarkId] = useState<string | null>(
    null,
  )
  // null = subtitles off. Auto-picks the track marked default once the
  // video loads so users don't have to tap through a menu just to see
  // captions in the language the coach picked as canonical.
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null)
  const subtitleAutoPickedRef = useRef(false)
  const scrollRef = useRef<ScrollViewInstance>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  // Opened on a bookmark (startAt), or on a saved segment (startAt+loopEndAt),
  // e.g. from «Мои заметки»: that start replaces the resume position once.
  const startAt = paramSeconds(route.params.startAt)
  const loopEndAt = paramSeconds(route.params.loopEndAt)
  const startSegment =
    startAt != null && loopEndAt != null && loopEndAt > startAt
  const pendingStartRef = useRef(startAt)
  const [loopA, setLoopA] = useState<number | null>(
    startSegment ? startAt : null,
  )
  const [loopB, setLoopB] = useState<number | null>(
    startSegment ? loopEndAt : null,
  )
  const loopRef = useRef<{ a: number | null; b: number | null }>({
    a: loopA,
    b: loopB,
  })
  // Opened on a bookmark with a drawing (e.g. from «Мои заметки»): the lesson
  // stays paused on that frame and the drawing comes up once bookmarks load.
  const pendingDrawingRef = useRef(route.params.drawingBookmarkId ?? null)
  const holdPausedRef = useRef(!!route.params.drawingBookmarkId)
  // A saved drawing over the paused frame (PlayerOverlay hides it on play).
  const [shownDrawing, setShownDrawing] = useState<ShownDrawing | null>(null)

  const playableUri = offlineUri ?? streamingUrl
  const resumeAppliedRef = useRef(false)

  const {
    player,
    PlayerSurface,
    failed: playbackFailed,
    builtInControls,
  } = usePlayer(playableUri ?? null)
  const [mirrored, setMirrored] = useState(false)
  // The lesson's «⋯» menu, and the drill timer it opens.
  const [moreOpen, setMoreOpen] = useState(false)
  const [drillOpen, setDrillOpen] = useState(false)
  const drill = useDrill()

  // The big title under the player names the lesson; the header names its
  // course (or nothing), never the lesson a second time.
  const courseTitle = course?.title ?? ""
  useLayoutEffect(() => {
    navigation.setOptions({ title: courseTitle })
  }, [navigation, courseTitle])
  // The app's own fullscreen (native only — Plyr has its own on web).
  const [fullscreen, setFullscreen] = useState(
    () => !builtInControls && !!route.params.fullscreen,
  )
  // The «Следующий урок через N с» card, after the lesson played to the end.
  const [upNextVisible, setUpNextVisible] = useState(false)
  // Playing a study plan («Мои планы»): the plan, the item on screen and the
  // item the «Дальше» countdown leads to.
  const planId = route.params.planId ?? null
  const requestedPlanIndex = paramSeconds(route.params.planItemIndex)
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [planIndex, setPlanIndex] = useState<number | null>(null)
  const [planUpNext, setPlanUpNext] = useState<number | null>(null)
  // The playing item's end was handled (countdown shown, or the plan done).
  const planEndHandledRef = useRef(false)
  // «Добавить в план»: what the picker would add.
  const [planDraft, setPlanDraft] = useState<PlanItemDraft | null>(null)

  const nextLesson = useMemo(() => {
    if (!course) return null
    const i = course.videos.findIndex((v) => v.id === videoId)
    return i >= 0 && i < course.videos.length - 1 ? course.videos[i + 1] : null
  }, [course, videoId])

  // A stored copy that won't play (files gone or damaged) must not leave a
  // dead player on screen: say why and how to get it back.
  useEffect(() => {
    if (!playbackFailed || !isOfflineSource) return
    let cancelled = false
    void getOfflineVideoState(videoId).then((local) => {
      if (cancelled) return
      setOfflineUri(null)
      setDownload(downloadStateFrom(local))
      setError(
        local.status === "lost"
          ? lostReasonMessage(local.reason)
          : "Не удалось воспроизвести загруженный урок. Удалите его в «Загруженных» и скачайте снова.",
      )
    })
    return () => {
      cancelled = true
    }
  }, [playbackFailed, isOfflineSource, videoId])

  useEffect(() => {
    void isFavorite(videoId).then(setFavorite)
  }, [videoId])

  // The track a lesson opens with follows the member's last choice (a
  // language, or Off) — once per lesson, when its tracks are known.
  useEffect(() => {
    if (subtitleAutoPickedRef.current) return
    const tracks = video?.subtitles
    if (!tracks || tracks.length === 0) return
    let cancelled = false
    void getSubtitleChoice().then((choice) => {
      if (cancelled || subtitleAutoPickedRef.current) return
      subtitleAutoPickedRef.current = true
      setActiveSubtitleId(pickSubtitleTrack(tracks, choice)?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [video?.subtitles])

  // A pick in «Субтитры» also becomes the choice for every other lesson.
  const handleSelectSubtitle = (id: string | null) => {
    subtitleAutoPickedRef.current = true
    setActiveSubtitleId(id)
    const track = video?.subtitles.find((s) => s.id === id) ?? null
    void setSubtitleChoice(choiceFromTrack(track))
  }

  // Subtitles ride above the player's controls and step aside for drawing
  // and the fullscreen drawer (PlayerOverlay reports both).
  const [subtitleLayout, setSubtitleLayout] = useState({ inset: 0, hidden: false })
  const getVideoSize = useCallback(() => {
    try {
      return player.videoSize
    } catch {
      return null
    }
  }, [player])

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

  // The playing chapter, highlighted in the side panel's «Главы». Polled only
  // for a lesson with chapters; the state changes once per chapter.
  const chapters = video?.timestamps
  const [currentChapter, setCurrentChapter] = useState(-1)
  useEffect(() => {
    if (!chapters || chapters.length === 0) return
    const tick = () => {
      const t = getCurrentTime()
      if (typeof t === "number") setCurrentChapter(chapterIndexAt(chapters, t))
    }
    tick()
    const id = setInterval(tick, CHAPTER_POLL_MS)
    return () => clearInterval(id)
  }, [chapters, getCurrentTime])

  useEffect(() => {
    void getProgressStatus(videoId, video?.duration).then(setProgressStatus)
  }, [videoId, video?.duration])

  // Lesson notes and bookmarks: the device copy paints at once (offline too),
  // then syncs with the server — now if online, on every return to the
  // network or the foreground, a moment after each edit, and on leaving.
  const network = useNetworkState()
  const online = Boolean(network.isConnected && network.isInternetReachable)
  const studyActiveRef = useRef(true)
  // An edit made here hasn't been handed to a sync yet.
  const studyEditedRef = useRef(false)
  const studySyncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const syncStudy = useCallback(async () => {
    studyEditedRef.current = false
    const result = await syncVideoStudy(videoId)
    if (!result || !studyActiveRef.current) return
    // Reloaded from the store (not taken from the result) so an edit made
    // while the sync ran is never painted over.
    if (result.bookmarksChanged) {
      const fresh = await listBookmarks(videoId)
      if (studyActiveRef.current) setBookmarks(fresh)
    }
    if (result.noteChanged) {
      const fresh = await getNote(videoId)
      if (studyActiveRef.current) setNoteText(fresh)
    }
  }, [videoId])

  const scheduleStudySync = () => {
    studyEditedRef.current = true
    clearTimeout(studySyncTimer.current)
    studySyncTimer.current = setTimeout(() => {
      void syncStudy()
    }, STUDY_SYNC_DEBOUNCE_MS)
  }

  useEffect(() => {
    studyActiveRef.current = true
    void listBookmarks(videoId).then((list) => {
      if (studyActiveRef.current) setBookmarks(list)
    })
    void getNote(videoId).then((text) => {
      if (studyActiveRef.current) setNoteText(text)
    })
    return () => {
      studyActiveRef.current = false
      clearTimeout(studySyncTimer.current)
      // The last edits go out on leaving.
      if (studyEditedRef.current) void syncVideoStudy(videoId)
      studyEditedRef.current = false
    }
  }, [videoId])

  // Opened on a drawing bookmark: show it once the list has it.
  useEffect(() => {
    const id = pendingDrawingRef.current
    const target = id ? bookmarks.find((b) => b.id === id) : undefined
    if (!target) return
    pendingDrawingRef.current = null
    if (target.drawing && !builtInControls) {
      setShownDrawing({
        bookmarkId: target.id,
        positionSec: target.positionSec,
        drawing: target.drawing,
      })
    }
  }, [bookmarks, builtInControls])

  // A shown drawing goes with its bookmark: removed (here or on another
  // device), or its drawing cleared, it leaves the picture too.
  useEffect(() => {
    if (!shownDrawing) return
    const owner = bookmarks.find((b) => b.id === shownDrawing.bookmarkId)
    if (!owner?.drawing) setShownDrawing(null)
  }, [bookmarks, shownDrawing])

  useEffect(() => {
    if (online) void syncStudy()
  }, [online, syncStudy])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" || (next === "background" && studyEditedRef.current)) {
        void syncStudy()
      }
    })
    return () => sub.remove()
  }, [syncStudy])

  useEffect(() => {
    loopRef.current = { a: loopA, b: loopB }
  }, [loopA, loopB])

  useEffect(() => {
    void getPreferences().then((p) => {
      setPlaybackRate(p.defaultPlaybackRate)
      setMirrored(p.mirrorVideo)
    })
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
      // A bookmark the lesson was opened on beats the resume position — once;
      // a later source switch (stream ↔ download) resumes as usual.
      const target = pendingStartRef.current ?? resumeAt
      try {
        if (target > 0) {
          ;(player as { currentTime: number }).currentTime = target
        }
      } catch {
        /* noop */
      }
      pendingStartRef.current = null
      resumeAppliedRef.current = true
      // Honour the "Автовоспроизведение" setting: only auto-start when it's on.
      // When off, the source is loaded (and resume position applied) but the
      // user presses play themselves.
      // Opened on a drawing: stay on its frame (once, like the start).
      const holdOnDrawing = holdPausedRef.current
      holdPausedRef.current = false
      if (prefs.autoplay && !holdOnDrawing) {
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

  // Fullscreen only once there is a player to fill the screen with; the
  // loading/error screens keep the header (and its back button).
  const showFullscreen =
    fullscreen && !!playableUri && !!video && !loading && !error

  // A covered lesson (a plan, «Сравнить», any screen on top) never plays on
  // underneath.
  useFocusEffect(
    useCallback(
      () => () => {
        try {
          player.pause()
        } catch {
          /* released on unmount */
        }
      },
      [player],
    ),
  )

  // Fullscreen hides the header (and with it any back gesture); Android's
  // back button leaves fullscreen before it leaves the lesson.
  useEffect(() => {
    navigation.setOptions({
      headerShown: !showFullscreen,
      gestureEnabled: !showFullscreen,
    })
    if (!showFullscreen) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setFullscreen(false)
      return true
    })
    return () => sub.remove()
  }, [navigation, showFullscreen])

  const planItem = plan && planIndex != null ? (plan.items[planIndex] ?? null) : null
  const nextPlanIndex =
    plan && planIndex != null ? adjacentPlayableIndex(plan.items, planIndex, 1) : null
  const prevPlanIndex =
    plan && planIndex != null ? adjacentPlayableIndex(plan.items, planIndex, -1) : null

  // Reaching the end offers the course's next lesson, unless an A–B loop is
  // running (its end is the loop's business), a study plan is playing (its
  // own «Дальше» takes over) or the setting is off. A lesson locked by
  // plan/rank is skipped; under locked progression finishing this one is
  // exactly what opens the next.
  const inPlan = planItem != null
  useEffect(() => {
    if (!playableUri || !nextLesson || inPlan) return
    if (nextLesson.lock && !course?.lockedProgression) return
    const sub = player.addListener("playToEnd", () => {
      const { a, b } = loopRef.current
      if (a != null && b != null) return
      void getPreferences().then((p) => {
        if (p.autoplayNext) setUpNextVisible(true)
      })
    })
    return () => sub.remove()
  }, [player, playableUri, nextLesson, course?.lockedProgression, inPlan])

  // A study plan being played: load it (cached for offline) and find the
  // item on screen. Keyed on the club id — the workspace object is refreshed
  // on every return to the app — and a reload keeps the item on screen while
  // it is still this lesson's. Without a plan the lesson simply plays alone.
  const workspaceId = workspace?.workspaceId ?? null
  useEffect(() => {
    if (!planId || !workspaceId) return
    let cancelled = false
    loadStudyPlan(workspaceId, planId)
      .then((loaded) => {
        if (cancelled) return
        setPlan(loaded)
        setPlanIndex((prev) =>
          prev != null && loaded.items[prev]?.videoId === videoId
            ? prev
            : resolvePlanIndex(loaded.items, requestedPlanIndex, videoId),
        )
      })
      .catch(() => {
        /* never opened online — nothing cached to follow */
      })
    return () => {
      cancelled = true
    }
  }, [planId, workspaceId, videoId, requestedPlanIndex])

  // The item is over — offer the next one (or say the plan is done).
  const finishPlanItem = useCallback(() => {
    if (planEndHandledRef.current) return
    planEndHandledRef.current = true
    if (nextPlanIndex != null) setPlanUpNext(nextPlanIndex)
    else showToast("План пройден")
  }, [nextPlanIndex, showToast])

  // A new item on screen starts unhandled (a reload of the same item doesn't).
  const planItemId = planItem?.id ?? null
  useEffect(() => {
    planEndHandledRef.current = false
  }, [planItemId])

  // A segment item ends at its endSec: pause there and count down.
  useEffect(() => {
    if (!playableUri || !planItem || planItem.endSec == null) return
    const id = setInterval(() => {
      if (planEndHandledRef.current) return
      const t = getCurrentTime()
      if (typeof t !== "number" || !reachedItemEnd(t, planItem)) return
      try {
        player.pause()
      } catch {
        /* noop */
      }
      finishPlanItem()
    }, PLAN_END_POLL_MS)
    return () => clearInterval(id)
  }, [playableUri, player, planItem, getCurrentTime, finishPlanItem])

  // A moment item (or a segment running to the end) ends with the lesson.
  useEffect(() => {
    if (!playableUri || !planItem) return
    const sub = player.addListener("playToEnd", finishPlanItem)
    return () => sub.remove()
  }, [player, playableUri, planItem, finishPlanItem])

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
      // Opening the lesson re-asks the server about a stored copy (when
      // online): lost access deletes it before anything plays.
      const local = await getOfflineVideoState(videoId, { revalidate: true })

      try {
        const videoData = await getVideo({
          workspaceId: workspace.workspaceId,
          videoId,
        })
        if (cancelled) return
        setVideo(videoData)

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
        setDownload(downloadStateFrom(local))

        // Prefer streaming whenever we're online: a downloaded HLS playlist
        // cannot be played from a local file:// on iOS (AVPlayer limitation),
        // and the stream is always fresher. The local copy is used only when
        // we're truly offline, or when streaming fails (handled in catch).
        if (local.status === "ready" && !(await isOnline())) {
          if (cancelled) return
          setOfflineUri(local.uri)
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
          setOfflineUri(cached.videoUri)
          setIsOfflineSource(true)
          setDownload(
            downloadStateFrom({
              status: "ready",
              uri: cached.videoUri,
              accessExpiresAt: cached.accessExpiresAt,
            }),
          )
        } else if (local.status === "lost") {
          // Never a player over files that are gone or no longer allowed.
          setError(lostReasonMessage(local.reason))
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
  }, [workspace, videoId, courseId, retryNonce])

  const handleRetry = () => {
    setRetryNonce((n) => n + 1)
  }

  // A download outlives the screen (web): coming back mid-download picks up
  // its progress, and its end refreshes the row.
  useEffect(() => {
    if (!offlineDownloadControls) return
    return offlineDownloadControls.subscribe((id, progress) => {
      if (id !== videoId) return
      if (progress) {
        setDownload(downloadingState(progress))
      } else {
        void getOfflineVideoState(videoId).then((local) =>
          setDownload(downloadStateFrom(local)),
        )
      }
    })
  }, [videoId])

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
      await downloadVideoForOffline({
        videoId,
        video,
        course: course ?? undefined,
        thumbnailUrl: video.thumbnailUrl,
        onProgress: (p) => setDownload(downloadingState(p)),
      })
      const local = await getOfflineVideoState(videoId)
      // Downloading just makes the video available offline — it must NOT yank
      // the player off the currently-playing stream onto the local copy (which
      // iOS can't play from file://). Only adopt the local source if nothing is
      // streaming (i.e. we're offline).
      if (local.status === "ready" && !streamingUrl) {
        setOfflineUri(local.uri)
        setIsOfflineSource(true)
      }
      setDownload(downloadStateFrom(local))
      haptics.success()
      showToast("Скачано — доступно офлайн", "success")
    } catch (err) {
      if (err instanceof OfflineDownloadInterrupted) {
        setDownload(downloadStateFrom(await getOfflineVideoState(videoId)))
        return
      }
      const message = errorMessage(err, "Не удалось скачать.")
      // Web keeps what was stored, so a dropped connection is resumable.
      const local = await getOfflineVideoState(videoId)
      setDownload(
        local.status === "partial"
          ? downloadStateFrom(local)
          : { status: "error", message },
      )
      haptics.warning()
      showToast(message, "error")
    }
  }

  const handlePauseDownload = () => {
    offlineDownloadControls?.pause(videoId)
  }

  const handleCancelDownload = async () => {
    await offlineDownloadControls?.cancel(videoId)
    setDownload({ status: "absent" })
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
    const feedback = shareFeedback(
      await shareText({
        title: video.title,
        message: `${video.title} — ${brand.displayName}`,
      }),
    )
    if (feedback) showToast(feedback)
  }

  // «Поделиться моментом» (the player, bookmark and chapter rows): a link
  // that opens this lesson at the second — a segment loops A–B.
  const handleShareMoment = async (moment: {
    startSec: number
    endSec?: number | null
    label?: string | null
  }) => {
    if (!video) return
    const url = buildMomentLink(momentLinkBase(), { videoId, ...moment })
    const feedback = shareFeedback(
      await shareText({
        title: video.title,
        message: momentShareText({ videoTitle: video.title, ...moment, url }),
      }),
    )
    if (feedback) showToast(feedback)
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

  const handleSelectRate = async (rate: number) => {
    setPlaybackRate(rate)
    await setPreferences({ defaultPlaybackRate: rate })
  }

  const handleToggleMirror = async () => {
    const next = !mirrored
    setMirrored(next)
    await setPreferences({ mirrorVideo: next })
  }

  // Same lesson switch as VideoCourseNav; leaving from fullscreen keeps it.
  const openLesson = (id: string, title?: string) =>
    navigation.replace("Video", {
      videoId: id,
      courseId: course?.id,
      title,
      fullscreen: showFullscreen || undefined,
    })

  const handleNoteChange = async (text: string) => {
    setNoteText(text)
    await setNote(videoId, text)
    scheduleStudySync()
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

  // Another item of the plan: a seek within this lesson, or that lesson in
  // this one's place (fullscreen kept).
  const goToPlanItem = (index: number) => {
    const target = plan?.items[index]
    if (!plan || !target) return
    setPlanUpNext(null)
    const step = planStep(target, videoId)
    if (step.kind === "seek") {
      setLoopA(null)
      setLoopB(null)
      loopRef.current = { a: null, b: null }
      setPlanIndex(index)
      seekTo(step.startSec)
      return
    }
    navigation.replace("Video", {
      videoId: step.videoId,
      title: target.video?.title ?? target.title,
      startAt: step.startSec,
      planId: plan.id,
      planItemIndex: index,
      fullscreen: showFullscreen || undefined,
    })
  }

  // «В план» on a chapter (up to the next one) or a bookmark / segment.
  const addChapterToPlan = (index: number) => {
    if (!video?.timestamps) return
    setPlanDraft(draftFromChapter(videoId, video.timestamps, index, video.duration))
  }
  const addBookmarkToPlan = (bookmarkId: string) => {
    const bookmark = bookmarks.find((b) => b.id === bookmarkId)
    if (bookmark) setPlanDraft(draftFromBookmark(videoId, bookmark))
  }

  // After a local edit: show the store's list (the source of truth) and let
  // the edit reach the server shortly.
  const reloadBookmarks = async () => {
    setBookmarks(await listBookmarks(videoId))
    scheduleStudySync()
  }

  const handleAddBookmark = async () => {
    const created = await addBookmark(videoId, readPlayerTime())
    await reloadBookmarks()
    setJustAddedBookmarkId(created.id)
    haptics.light()
    showToast("Закладка добавлена")
  }

  // The current A–B as a segment bookmark; its name field opens like a new one.
  const handleSaveSegment = async () => {
    if (loopA == null || loopB == null) return
    const { positionSec, endSec } = segmentBounds(loopA, loopB)
    const created = await addBookmark(videoId, positionSec, endSec)
    await reloadBookmarks()
    setJustAddedBookmarkId(created.id)
    haptics.light()
    showToast("Отрезок сохранён в закладки")
  }

  const handlePlaySegment = (startSec: number, endSec: number) => {
    setLoopA(startSec)
    setLoopB(endSec)
    loopRef.current = { a: startSec, b: endSec }
    seekTo(startSec)
  }

  // Pause on a bookmark's frame and bring up its drawing.
  const showDrawingAt = (b: {
    id: string
    positionSec: number
    drawing: BookmarkDrawing
  }) => {
    try {
      player.pause()
      player.currentTime = Math.max(0, b.positionSec)
    } catch {
      /* noop */
    }
    setShownDrawing({ bookmarkId: b.id, positionSec: b.positionSec, drawing: b.drawing })
  }

  // A bookmark row's time (side panel, fullscreen drawer): a segment loops
  // A–B, a moment with a drawing pauses on it (the web player can't show
  // drawings — there it seeks like any moment), any other moment seeks.
  const handleOpenBookmark = (b: {
    id: string
    positionSec: number
    endSec: number | null
    drawing: BookmarkDrawing | null
  }) => {
    if (b.endSec != null) handlePlaySegment(b.positionSec, b.endSec)
    else if (b.drawing && !builtInControls) showDrawingAt({ ...b, drawing: b.drawing })
    else seekTo(b.positionSec)
  }

  // «Сохранить» in «Рисовать»: onto the bookmark whose drawing was edited, else
  // the moment bookmark at this second, else a new one (whose name field opens
  // like «+ закладка»); null = cleared.
  const handleSaveDrawing = async (
    drawing: BookmarkDrawing | null,
    bookmarkId: string | null,
  ) => {
    const saved = await saveBookmarkDrawing(
      videoId,
      readPlayerTime(),
      drawing,
      bookmarkId,
    )
    if (!saved) return
    await reloadBookmarks()
    const { bookmark, created } = saved
    setShownDrawing(
      drawing
        ? { bookmarkId: bookmark.id, positionSec: bookmark.positionSec, drawing }
        : null,
    )
    if (created) setJustAddedBookmarkId(bookmark.id)
    haptics.light()
    showToast(
      !drawing
        ? "Рисунок удалён"
        : created
          ? "Рисунок сохранён в новую закладку"
          : "Рисунок сохранён в закладку",
    )
  }

  // «Сравнить»: this lesson on the left from here — or from the A–B segment
  // when one is set (leaving pauses the lesson, see the focus effect).
  const openCompare = () => {
    const segment = loopA != null && loopB != null && loopB > loopA
    navigation.navigate("Compare", {
      videoId,
      title: video?.title,
      startAt: segment ? loopA : readPlayerTime(),
      endAt: segment ? loopB : undefined,
    })
  }

  const handleRemoveBookmark = async (id: string) => {
    await removeBookmark(videoId, id)
    await reloadBookmarks()
  }

  const handleUpdateBookmark = async (
    id: string,
    patch: Partial<Pick<MyVideoBookmark, "label" | "note">>,
  ) => {
    await updateBookmark(videoId, id, patch)
    await reloadBookmarks()
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
      showAlert("Сначала отметьте точку A раньше точки B.")
    }
  }

  const handleClearLoop = () => {
    setLoopA(null)
    setLoopB(null)
  }

  const handleConfirmRemoveOffline = () => {
    showAlert("Удалить из загруженного?", video?.title ?? "", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: handleRemoveOffline },
    ])
  }

  // A choice in the lesson's «⋯»: the sheet closes first, then it runs.
  const fromMenu = (fn: () => void) => () => {
    setMoreOpen(false)
    fn()
  }

  const runDownloadAction = (kind: DownloadAction["kind"]) => {
    switch (kind) {
      case "download":
        void handleDownload()
        return
      case "pause":
        handlePauseDownload()
        return
      case "cancel":
        void handleCancelDownload()
        return
      case "remove":
        handleConfirmRemoveOffline()
        return
    }
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

  const lessonWatched = progressStatus.status === "watched"
  const subtitles = video.subtitles ?? []
  const loopSet = loopA != null || loopB != null
  const downloadActions = offlineDownloads
    ? downloadMenuActions(download, {
        canDownload: !!streamingUrl,
        controllable: !!offlineDownloadControls,
      })
    : []
  const drillRunning = isDrillRunning(drill.phase)

  const playerStyle = showFullscreen
    ? styles.playerFullscreen
    : isWide
      ? styles.playerColWide
      : [styles.playerWrap, { maxHeight: Math.round(height * 0.55) }]

  const picture = (
    <>
      <PlayerSurface
        style={styles.player}
        contentFit="contain"
        mirrored={mirrored}
      />
      {activeSubtitle && !subtitleLayout.hidden && (
        <SubtitleOverlay
          url={activeSubtitle.publicUrl}
          getCurrentTime={getCurrentTime}
          getVideoSize={getVideoSize}
          bottomInset={subtitleLayout.inset}
        />
      )}
    </>
  )

  const upNext = upNextVisible && nextLesson && (
    <NextLessonCountdown
      title={nextLesson.title}
      player={player}
      onCancel={() => setUpNextVisible(false)}
      onPlayNow={() => {
        setUpNextVisible(false)
        openLesson(nextLesson.id, nextLesson.title)
      }}
    />
  )

  const planNext = plan && planUpNext != null ? plan.items[planUpNext] : null
  const planUpNextCard = planNext && planUpNext != null && (
    <NextLessonCountdown
      kind="planItem"
      title={planNext.title || planNext.video?.title || "Следующий фрагмент"}
      player={player}
      onCancel={() => setPlanUpNext(null)}
      onPlayNow={() => goToPlanItem(planUpNext)}
    />
  )

  const planBar: PlanBarProps | null =
    plan && planIndex != null
      ? {
          title: plan.title,
          position: `${planIndex + 1}/${plan.items.length}`,
          onPrev: prevPlanIndex != null ? () => goToPlanItem(prevPlanIndex) : null,
          onNext: nextPlanIndex != null ? () => goToPlanItem(nextPlanIndex) : null,
        }
      : null

  return (
    <SafeAreaView
      style={styles.root}
      edges={showFullscreen ? [] : ["bottom"]}
    >
      {showFullscreen && <StatusBar hidden animated />}
      <View style={[styles.layout, isWide && styles.layoutWide]}>
      {!playableUri ? (
        <View style={playerStyle}>
          <View style={[styles.player, styles.playerPlaceholder]}>
            <Text style={styles.muted}>Видео ещё не готово к просмотру.</Text>
          </View>
        </View>
      ) : builtInControls ? (
        <HoldToBoostArea player={player} style={playerStyle}>
          {picture}
          {upNext}
          {planUpNextCard}
        </HoldToBoostArea>
      ) : (
        <View style={playerStyle}>
          {picture}
          <PlayerOverlay
            player={player}
            title={video.title}
            playbackRate={playbackRate}
            onSelectRate={(rate) => void handleSelectRate(rate)}
            mirrored={mirrored}
            onToggleMirror={() => void handleToggleMirror()}
            fullscreen={showFullscreen}
            onToggleFullscreen={() => setFullscreen(!showFullscreen)}
            loopA={loopA}
            loopB={loopB}
            onSetLoopA={handleSetLoopA}
            onSetLoopB={handleSetLoopB}
            onClearLoop={handleClearLoop}
            onAddBookmark={() => void handleAddBookmark()}
            onSaveSegment={() => void handleSaveSegment()}
            chapters={video.timestamps}
            bookmarks={bookmarks}
            onSeek={seekTo}
            onOpenBookmark={handleOpenBookmark}
            onShareMoment={(m) => void handleShareMoment(m)}
            shownDrawing={shownDrawing}
            onHideDrawing={() => setShownDrawing(null)}
            onSaveDrawing={(drawing, bookmarkId) =>
              void handleSaveDrawing(drawing, bookmarkId)
            }
            onSubtitleLayout={setSubtitleLayout}
            subtitles={subtitles}
            activeSubtitleId={activeSubtitleId}
            onSelectSubtitle={handleSelectSubtitle}
            plan={planBar}
            onAddChapterToPlan={addChapterToPlan}
            onAddBookmarkToPlan={addBookmarkToPlan}
          />
          {upNext}
          {planUpNextCard}
        </View>
      )}

      {/* Notes and bookmark names are typed at the bottom of this panel. With
          edge-to-edge Android no longer shrinks the window for the keyboard,
          so the panel has to — and Android then scrolls the focused field
          back into view on its own. Fullscreen only hides it, so drafts and
          scroll position survive. */}
      <KeyboardAvoidingContainer
        style={[
          isWide ? styles.scrollWide : styles.scrollNarrow,
          showFullscreen && styles.hidden,
        ]}
      >
      <ScrollView
        ref={scrollRef}
        {...keyboardScroll}
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {planBar && plan && (
          <PlanBar
            variant="panel"
            {...planBar}
            onOpen={() =>
              navigation.navigate(
                "StudyPlan",
                { planId: plan.id, title: plan.title },
                // Back to the plan screen it was opened from, not a second one.
                { pop: true },
              )
            }
          />
        )}
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
            <Icon
              name={favorite ? "star" : "star-outline"}
              size={26}
              color={favorite ? theme.colors.accent : theme.colors.mutedFaint}
            />
          </Pressable>
        </View>

        {course && currentIndex >= 0 && course.videos.length > 1 && (
          <Text style={styles.muted}>
            Урок {currentIndex + 1} из {course.videos.length}
          </Text>
        )}
        {video.description ? (
          <Text style={styles.description}>{video.description}</Text>
        ) : null}

        <View style={styles.actionsRow}>
          {/* Under locked progression only really watching a lesson opens the
              next one (the server ignores a manual mark), so no toggle. */}
          {!course?.lockedProgression && (
            <Pressable
              onPress={handleToggleWatched}
              accessibilityRole="switch"
              accessibilityLabel="Просмотрено"
              accessibilityState={{ checked: lessonWatched }}
              style={[styles.action, lessonWatched && styles.actionOn]}
            >
              <Icon
                name={lessonWatched ? "checkmark-circle" : "checkmark-circle-outline"}
                size={18}
                color={lessonWatched ? theme.colors.accent : theme.colors.muted}
              />
              <Text style={[styles.actionText, lessonWatched && styles.actionTextOn]}>
                Просмотрено
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setPlanDraft(draftFromMoment(videoId, readPlayerTime()))}
            accessibilityRole="button"
            accessibilityLabel="Добавить текущий момент в план"
            style={styles.action}
          >
            <Icon name="add" size={18} color={theme.colors.text} />
            <Text style={styles.actionText}>В план</Text>
          </Pressable>
          {/* The app's player has its own share; Plyr (web) doesn't. */}
          {builtInControls && (
            <Pressable
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Поделиться"
              style={styles.action}
            >
              <Icon name="share-outline" size={18} color={theme.colors.text} />
              <Text style={styles.actionText}>Поделиться</Text>
            </Pressable>
          )}
          <MoreButton onPress={() => setMoreOpen(true)} hint="Действия с уроком" />
        </View>

        <VideoDownloadStatus download={download} playingOffline={isOfflineSource} />

        {/* Only while an A–B point is set (started from «⋯»). */}
        <VideoLoopControls
          loopA={loopA}
          loopB={loopB}
          onSetA={handleSetLoopA}
          onSetB={handleSetLoopB}
          onClear={handleClearLoop}
          onSaveSegment={() => void handleSaveSegment()}
        />
        <VideoStudyTools
          timestamps={video?.timestamps}
          currentChapter={currentChapter}
          bookmarks={bookmarks}
          note={note}
          onSeek={seekTo}
          onOpenBookmark={handleOpenBookmark}
          onShareMoment={(m) => void handleShareMoment(m)}
          onAddBookmark={handleAddBookmark}
          onRemoveBookmark={(id) => void handleRemoveBookmark(id)}
          onUpdateBookmark={(id, patch) => void handleUpdateBookmark(id, patch)}
          justAddedBookmarkId={justAddedBookmarkId}
          onNoteChange={handleNoteChange}
          onAddChapterToPlan={addChapterToPlan}
          onAddBookmarkToPlan={addBookmarkToPlan}
        />

        <VideoCourseNav
          videos={course?.videos ?? []}
          currentIndex={currentIndex}
          prevId={prevId}
          nextId={nextId}
          onNavigate={openLesson}
        />
      </ScrollView>
      </KeyboardAvoidingContainer>
      </View>
      {moreOpen && (
        <Sheet title="Урок" onClose={() => setMoreOpen(false)}>
          <View>
            <MenuOption
              role="switch"
              label="Зеркально"
              selected={mirrored}
              onPress={fromMenu(() => void handleToggleMirror())}
            />
            <MenuOption
              role="switch"
              label="A–B повтор"
              selected={loopSet}
              onPress={fromMenu(loopSet ? handleClearLoop : handleSetLoopA)}
            />
            {/* Two side-by-side pictures need the app's own player (native). */}
            {!builtInControls && (
              <MenuOption label="Сравнить" onPress={fromMenu(openCompare)} />
            )}
            <MenuOption
              label="Дрилл-таймер"
              detail={drillRunning ? `Идёт · ${formatClock(drill.remaining)}` : undefined}
              onPress={fromMenu(() => setDrillOpen(true))}
            />
            {/* Native picks subtitles with the player's CC button. */}
            {builtInControls && subtitles.length > 0 && (
              <SubtitleMenuOptions
                subtitles={subtitles}
                activeId={activeSubtitleId}
                onSelect={(id) => fromMenu(() => handleSelectSubtitle(id))()}
              />
            )}
            {downloadActions.map((a) => (
              <MenuOption
                key={a.kind}
                label={a.label}
                detail={a.detail}
                disabled={a.disabled}
                destructive={a.destructive}
                onPress={fromMenu(() => runDownloadAction(a.kind))}
              />
            ))}
          </View>
        </Sheet>
      )}
      {drillOpen && <DrillModal onClose={() => setDrillOpen(false)} />}
      {planDraft && (
        <AddToPlanModal draft={planDraft} onClose={() => setPlanDraft(null)} />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Stacked by default (player on top, content scrolls below); on wide screens
  // the two become side-by-side columns — video left, a scrollable panel right.
  layout: { flex: 1 },
  layoutWide: { flexDirection: "row" },
  playerWrap: { backgroundColor: theme.colors.playerBg, aspectRatio: 16 / 9 },
  // Wide layout: the video fills the left column and letterboxes (contentFit
  // "contain"), so a portrait clip doesn't force a huge 16:9 block.
  playerColWide: { flex: 1, backgroundColor: theme.colors.playerBg },
  // Narrow: the ScrollView must take the remaining bounded height so it becomes
  // an actual scroll region on web (otherwise the content below an oversized
  // player is unreachable). Wide: a fixed side panel that scrolls on its own.
  flex: { flex: 1 },
  scrollNarrow: { flex: 1 },
  scrollWide: {
    width: 400,
    flexGrow: 0,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  player: { width: "100%", height: "100%" },
  // The app's fullscreen: the picture takes the whole window.
  playerFullscreen: { flex: 1, backgroundColor: theme.colors.playerBg },
  hidden: { display: "none" },
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
  description: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  muted: { ...theme.typography.caption },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  // One quiet pill per action; «Просмотрено» when on is tinted, not filled.
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    minHeight: 40,
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionOn: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentSoft,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
  },
  actionTextOn: { color: theme.colors.accent },
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
