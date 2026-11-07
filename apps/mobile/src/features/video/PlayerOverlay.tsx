// Native player controls, drawn by the app over a bare expo-video picture
// (`nativeControls={false}`) — inline and in the app's own fullscreen alike.
//
// Why fully custom instead of native controls inline + custom only in
// fullscreen: on Android the native controller lives *inside* the VideoView,
// so (1) the mirror flip (scaleX: -1 on the view) would flip the controls and
// their text too, (2) the controller consumes every tap, so single/double tap
// and hold gestures could only be guessed at around it, and (3) its fullscreen
// button opens a separate system window where none of the app's tools exist.
// One overlay everywhere makes mirror, gestures, frame step and the fullscreen
// toolbar behave the same in both modes. The web build keeps Plyr's controls
// (see HoldToBoostArea) and never renders this.
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  BackHandler,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { BookmarkDrawing, DrawingStroke } from "../../shared/api/video-study"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { BoostBadge } from "./BoostBadge"
import { formatPosition } from "./format-position"
import {
  ChapterDrawer,
  type PlayerBookmark,
  type PlayerChapter,
} from "./ChapterDrawer"
import { chapterIndexAt, nextChapterTarget, prevChapterTarget } from "./chapter-nav"
import { DrawingCanvas } from "./DrawingCanvas"
import { DrawingEditor } from "./DrawingEditor"
import {
  containRect,
  SHOWN_DRAWING_DRIFT_SEC,
  type ShownDrawing,
} from "./drawing-math"
import type { SharedMoment } from "./moment-link"
import { PlaybackRatePopover } from "./PlaybackSpeedPicker"
import { clampSeek, frameStepTarget, positionOnTrack } from "./player-math"
import type { PlayerHandle } from "./player-types"
import { usePlayerGestures, type SeekFeedback } from "./use-player-gestures"
import { PlanBar, type PlanBarProps } from "../study-plans/PlanBar"

// Controls fade out this long after the last touch while playing.
const AUTO_HIDE_MS = 3500
const POLL_MS = 250
// While dragging the seek bar, seek the picture at most this often.
const SCRUB_SEEK_MS = 100
// The speed popover sits this far above the bottom edge (clear of the bar).
const POPOVER_BOTTOM = 96
// The current-chapter line above the seek bar (videos with chapters only).
const CHAPTER_ROW_HEIGHT = 20
// The fullscreen top bar below the safe-area inset (40 px button + padding).
const TOP_BAR_HEIGHT = 56
// The centre play button; its style uses the same size.
const PLAY_BUTTON_SIZE = 64
// Two subtitle lines with their padding: less room than this between the
// centre row and the bottom bar and a cue is hidden while controls show.
const MIN_CUE_ROOM = 56
// Inline the player sits inside the screen: the drawing toolbar needs no
// safe-area padding there.
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

type Props = {
  player: PlayerHandle
  title: string
  playbackRate: number
  onSelectRate: (rate: number) => void
  mirrored: boolean
  onToggleMirror: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  // Fullscreen-only study tools (inline, the side panel has them).
  loopA: number | null
  loopB: number | null
  onSetLoopA: () => void
  onSetLoopB: () => void
  onClearLoop: () => void
  onAddBookmark: () => void
  // Keep the current A–B as a segment bookmark; offered once both are set.
  onSaveSegment: () => void
  // The lesson's chapters (ordered by start); empty = no chapter UI at all.
  chapters: ReadonlyArray<PlayerChapter>
  // Listed with the chapters in the fullscreen «Главы» drawer.
  bookmarks: ReadonlyArray<PlayerBookmark>
  // Drawer taps, same as the side panel's: a chapter seeks (and plays); a
  // bookmark opens like in the panel (segment loop, drawing on the frame).
  onSeek: (sec: number) => void
  onOpenBookmark: (bookmark: PlayerBookmark) => void
  // «Поделиться моментом»: the player's own (this second, or the A–B) and the
  // fullscreen drawer's rows.
  onShareMoment: (moment: SharedMoment) => void
  // A saved drawing shown over its paused frame; hidden on play, on leaving
  // that frame, or ✕.
  shownDrawing: ShownDrawing | null
  onHideDrawing: () => void
  // «Рисовать» → «Сохранить» on the frame at the current (whole) second, onto
  // `bookmarkId` when an existing drawing was edited; null removes it.
  onSaveDrawing: (drawing: BookmarkDrawing | null, bookmarkId: string | null) => void
  // Where subtitles may go: `inset` px of controls covering the bottom (the
  // seek bar with its chapter line), `hidden` while «Рисовать» or the
  // fullscreen drawer takes the picture.
  onSubtitleLayout: (layout: { inset: number; hidden: boolean }) => void
  // Playing a study plan: «План: … · 3/7» with previous/next item.
  plan?: PlanBarProps | null
  // The fullscreen drawer's «В план» on chapters and bookmarks.
  onAddChapterToPlan?: (index: number) => void
  onAddBookmarkToPlan?: (bookmarkId: string) => void
}

type Snapshot = { time: number; duration: number | undefined; playing: boolean }

const readSnapshot = (player: PlayerHandle): Snapshot => ({
  time: player.currentTime,
  duration: player.duration,
  playing: player.playing,
})

export function PlayerOverlay({
  player,
  title,
  playbackRate,
  onSelectRate,
  mirrored,
  onToggleMirror,
  fullscreen,
  onToggleFullscreen,
  loopA,
  loopB,
  onSetLoopA,
  onSetLoopB,
  onClearLoop,
  onAddBookmark,
  onSaveSegment,
  chapters,
  bookmarks,
  onSeek,
  onOpenBookmark,
  onShareMoment,
  shownDrawing,
  onHideDrawing,
  onSaveDrawing,
  onSubtitleLayout,
  plan,
  onAddChapterToPlan,
  onAddBookmarkToPlan,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [speedOpen, setSpeedOpen] = useState(false)
  // The fullscreen «Главы» drawer.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Position under the finger while dragging the seek bar.
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(() => readSnapshot(player))
  // Bumped by every control press: restarts the auto-hide countdown.
  const [interaction, setInteraction] = useState(0)
  // The player's size: the picture's letterboxed rect (drawings) and the
  // popover's room.
  const [size, setSize] = useState({ width: 0, height: 0 })
  // The bottom control bar's height, for lifting subtitles over it.
  const [barHeight, setBarHeight] = useState(0)
  // «Рисовать» is open (it owns every touch until saved or cancelled), with
  // the drawing it edits: the one shown, or the one already saved on this
  // second's bookmark — never a blank sheet over an existing drawing.
  const [drawingSeed, setDrawingSeed] = useState<{
    bookmarkId: string | null
    strokes: readonly DrawingStroke[]
  } | null>(null)
  const drawingMode = drawingSeed !== null
  const lastScrubSeek = useRef(0)

  const refresh = useCallback(() => setSnapshot(readSnapshot(player)), [player])

  const { boosted, seekFeedback, responderProps } = usePlayerGestures({
    player,
    onTap: () => {
      setSpeedOpen(false)
      setControlsVisible((v) => !v)
    },
    onSeekBy: (seconds) => {
      player.currentTime = clampSeek(player.currentTime + seconds, player.duration)
      refresh()
    },
  })

  useEffect(() => {
    if (!controlsVisible) return
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [controlsVisible, refresh])

  useEffect(() => {
    if (
      !controlsVisible ||
      !snapshot.playing ||
      speedOpen ||
      drawerOpen ||
      scrubTime != null
    ) {
      return
    }
    const id = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS)
    return () => clearTimeout(id)
  }, [controlsVisible, snapshot.playing, speedOpen, drawerOpen, scrubTime, interaction])

  // The drawer is fullscreen-only: leaving fullscreen drops it.
  useEffect(() => {
    if (!fullscreen) setDrawerOpen(false)
  }, [fullscreen])

  // Android back closes the drawer before it leaves fullscreen: subscribed
  // after the screen's fullscreen handler, so it runs first (newest wins).
  useEffect(() => {
    if (!drawerOpen) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setDrawerOpen(false)
      return true
    })
    return () => sub.remove()
  }, [drawerOpen])

  // Back leaves «Рисовать» without saving (before fullscreen or the lesson).
  useEffect(() => {
    if (!drawingMode) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setDrawingSeed(null)
      return true
    })
    return () => sub.remove()
  }, [drawingMode])

  // A shown drawing belongs to its paused frame: playing on, or moving off
  // that frame, hides it. Playing hides it at once; the frame check arms only
  // once the player has settled there paused — the seek that brings a drawing
  // up lands a moment after it is shown. The callback goes through a ref so
  // re-renders don't restart the poll.
  const hideDrawingRef = useRef(onHideDrawing)
  hideDrawingRef.current = onHideDrawing
  useEffect(() => {
    if (!shownDrawing) return
    let armed = false
    const id = setInterval(() => {
      if (player.playing) {
        hideDrawingRef.current()
        return
      }
      const onFrame =
        Math.abs(player.currentTime - shownDrawing.positionSec) <=
        SHOWN_DRAWING_DRIFT_SEC
      if (!armed) armed = onFrame
      else if (!onFrame) hideDrawingRef.current()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [shownDrawing, player])

  // Wraps a control's handler: keeps the controls up and the readout fresh.
  const act = (fn: () => void) => () => {
    fn()
    setInteraction((n) => n + 1)
    refresh()
  }

  const togglePlay = act(() => {
    if (player.playing) {
      player.pause()
      return
    }
    const { duration } = player
    // Play after the end restarts the lesson.
    if (duration && player.currentTime >= duration - 0.25) player.currentTime = 0
    player.play()
  })

  const stepFrame = (direction: 1 | -1) =>
    act(() => {
      if (player.playing) player.pause()
      player.currentTime = frameStepTarget(
        player.currentTime,
        direction,
        player.frameRate,
        player.duration,
      )
    })

  // Chapter jumps keep the play/pause state, like the seek bar. The target is
  // picked from the player's live time, not the last polled readout.
  const jumpChapter = (
    pick: (chapters: Props["chapters"], time: number) => number | null,
  ) =>
    act(() => {
      const target = pick(chapters, player.currentTime)
      if (target != null) player.currentTime = clampSeek(target, player.duration)
    })

  // A drawer row: the screen seeks/loops (and plays), the drawer closes.
  const fromDrawer = (fn: () => void) => {
    fn()
    setDrawerOpen(false)
    setInteraction((n) => n + 1)
    refresh()
  }

  // Bookmarks keep whole seconds, so the frame snaps to one before drawing:
  // what is drawn on is exactly the frame the bookmark reopens.
  const startDrawing = act(() => {
    player.pause()
    const second = clampSeek(Math.round(player.currentTime), player.duration)
    player.currentTime = second
    const saved = bookmarks.find(
      (b) => b.endSec === null && b.positionSec === Math.round(second) && b.drawing,
    )
    setSpeedOpen(false)
    setDrawerOpen(false)
    setDrawingSeed(
      shownDrawing
        ? { bookmarkId: shownDrawing.bookmarkId, strokes: shownDrawing.drawing.strokes }
        : { bookmarkId: saved?.id ?? null, strokes: saved?.drawing?.strokes ?? [] },
    )
  })

  const time = scrubTime ?? snapshot.time
  const loopSet = loopA != null || loopB != null
  const iconColor = theme.colors.onOverlay
  const hasChapters = chapters.length > 0
  // While scrubbing, `time` is under the thumb: so is this chapter.
  const chapterIndex = chapterIndexAt(chapters, time)
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : null
  const nextTarget = nextChapterTarget(chapters, time)
  // Where the picture sits in the player (contain letterboxing).
  const pictureRect = containRect(size, player.videoSize)
  const showControls = controlsVisible && !drawingMode
  const subtitleInset = showControls ? barHeight : 0
  // The centre row (64 pt play button) sits mid-player. On a short inline
  // player, a cue lifted over the bottom bar would land on it: with less than
  // two lines of room between them, the cue waits until the controls hide.
  const roomAboveBar = size.height / 2 - PLAY_BUTTON_SIZE / 2 - barHeight
  const noRoomForCue = showControls && size.height > 0 && roomAboveBar < MIN_CUE_ROOM
  const subtitlesHidden = drawingMode || (drawerOpen && fullscreen) || noRoomForCue
  const subtitleLayoutRef = useRef(onSubtitleLayout)
  subtitleLayoutRef.current = onSubtitleLayout
  useEffect(() => {
    subtitleLayoutRef.current({ inset: subtitleInset, hidden: subtitlesHidden })
  }, [subtitleInset, subtitlesHidden])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) =>
        setSize({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
    >
      {/* The gesture layer: tap toggles controls, double tap on a side third
          seeks ∓10 s, hold plays at 2x. Controls drawn after it take their
          own touches first (so scrubbing the seek bar never boosts). */}
      <View
        style={StyleSheet.absoluteFill}
        collapsable={false}
        {...responderProps}
      />
      {seekFeedback && <SeekRipple feedback={seekFeedback} />}
      {boosted && <BoostBadge />}

      {shownDrawing && !drawingMode && (
        <DrawingCanvas
          strokes={shownDrawing.drawing.strokes}
          rect={pictureRect}
          mirrored={mirrored}
        />
      )}

      {showControls && (
        <>
          {fullscreen && (
            <View
              style={[
                styles.topBar,
                {
                  paddingTop: theme.spacing(2) + insets.top,
                  paddingLeft: theme.spacing(2) + insets.left,
                  paddingRight: theme.spacing(3) + insets.right,
                },
              ]}
            >
              <IconButton
                icon="arrow-back"
                label="Выйти из полноэкранного режима"
                onPress={onToggleFullscreen}
              />
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {plan && <PlanBar variant="overlay" {...plan} />}
            </View>
          )}
          {!fullscreen && plan && (
            <View style={styles.planInline} pointerEvents="box-none">
              <PlanBar variant="overlay" {...plan} />
            </View>
          )}

          <View style={styles.centerRow} pointerEvents="box-none">
            {hasChapters && (
              <IconButton
                icon="play-skip-back"
                label="Предыдущая глава"
                onPress={jumpChapter(prevChapterTarget)}
              />
            )}
            <IconButton
              icon="chevron-back"
              label="Кадр назад"
              onPress={stepFrame(-1)}
            />
            <Pressable
              onPress={togglePlay}
              accessibilityLabel={snapshot.playing ? "Пауза" : "Смотреть"}
              style={styles.playButton}
            >
              <Icon
                name={snapshot.playing ? "pause" : "play"}
                size={34}
                color={iconColor}
              />
            </Pressable>
            <IconButton
              icon="chevron-forward"
              label="Кадр вперёд"
              onPress={stepFrame(1)}
            />
            {hasChapters && (
              <IconButton
                icon="play-skip-forward"
                label="Следующая глава"
                disabled={nextTarget == null}
                onPress={jumpChapter(nextChapterTarget)}
              />
            )}
          </View>

          <View
            style={[
              styles.bottomBar,
              fullscreen && {
                paddingBottom: theme.spacing(2) + insets.bottom,
                paddingLeft: theme.spacing(3) + insets.left,
                paddingRight: theme.spacing(3) + insets.right,
              },
            ]}
            onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          >
            {hasChapters && (
              // Height kept even in the lead-in before chapter 1, so the bar
              // doesn't jump when the first chapter starts.
              <Text
                style={[styles.chapterLabel, scrubTime != null && styles.chapterScrub]}
                numberOfLines={1}
              >
                {chapter
                  ? `${chapterIndex + 1}/${chapters.length} · ${chapter.title}`
                  : ""}
              </Text>
            )}
            <SeekBar
              time={time}
              duration={snapshot.duration}
              loopA={loopA}
              loopB={loopB}
              chapters={chapters}
              onScrub={(t) => {
                setScrubTime(t)
                const now = Date.now()
                if (t != null && now - lastScrubSeek.current >= SCRUB_SEEK_MS) {
                  lastScrubSeek.current = now
                  player.currentTime = t
                }
              }}
              onSeek={(t) => {
                player.currentTime = t
                setScrubTime(null)
                setInteraction((n) => n + 1)
                refresh()
              }}
            />
            <View style={styles.toolbar}>
              <Text style={styles.time}>
                {formatPosition(time)}
                {snapshot.duration ? ` / ${formatPosition(snapshot.duration)}` : ""}
              </Text>
              <View style={styles.spacer} />
              {fullscreen && (
                <>
                  {hasChapters && (
                    <ChipButton
                      label="Главы"
                      accessibilityLabel="Главы и закладки"
                      active={drawerOpen}
                      onPress={act(() => {
                        setSpeedOpen(false)
                        setDrawerOpen(true)
                      })}
                    />
                  )}
                  <ChipButton
                    label={loopA != null ? `A ${formatPosition(loopA)}` : "A"}
                    accessibilityLabel="Отметить точку A"
                    active={loopA != null}
                    onPress={act(onSetLoopA)}
                  />
                  <ChipButton
                    label={loopB != null ? `B ${formatPosition(loopB)}` : "B"}
                    accessibilityLabel="Отметить точку B"
                    active={loopB != null}
                    onPress={act(onSetLoopB)}
                  />
                  {loopSet && (
                    <IconButton
                      icon="close-circle-outline"
                      label="Сбросить повтор A–B"
                      onPress={act(onClearLoop)}
                    />
                  )}
                  {loopA != null && loopB != null && (
                    <ChipButton
                      label="Сохранить отрезок"
                      accessibilityLabel="Сохранить отрезок A–B в закладки"
                      onPress={act(onSaveSegment)}
                    />
                  )}
                  <ChipButton
                    label="+ закладка"
                    accessibilityLabel="Добавить закладку"
                    onPress={act(onAddBookmark)}
                  />
                </>
              )}
              {!snapshot.playing && (
                <ChipButton
                  label="✎ Рисовать"
                  accessibilityLabel="Рисовать на кадре"
                  onPress={startDrawing}
                />
              )}
              <ChipButton
                label={`${playbackRate}x`}
                accessibilityLabel={`Скорость ${playbackRate}x, выбрать`}
                active={speedOpen}
                onPress={act(() => setSpeedOpen((v) => !v))}
              />
              <IconButton
                icon="share-outline"
                label={
                  loopA != null && loopB != null
                    ? "Поделиться отрезком A–B"
                    : "Поделиться моментом"
                }
                onPress={act(() =>
                  onShareMoment(
                    loopA != null && loopB != null
                      ? { startSec: loopA, endSec: loopB }
                      : { startSec: player.currentTime, label: chapter?.title },
                  ),
                )}
              />
              <IconButton
                icon="swap-horizontal"
                label={mirrored ? "Отключить зеркало" : "Зеркально"}
                active={mirrored}
                onPress={act(onToggleMirror)}
              />
              <IconButton
                icon={fullscreen ? "contract" : "expand"}
                label={
                  fullscreen
                    ? "Выйти из полноэкранного режима"
                    : "Во весь экран"
                }
                onPress={onToggleFullscreen}
              />
            </View>
          </View>

          {speedOpen && (
            <PlaybackRatePopover
              style={[
                styles.speedPopover,
                {
                  bottom:
                    POPOVER_BOTTOM +
                    (hasChapters ? CHAPTER_ROW_HEIGHT : 0) +
                    (fullscreen ? insets.bottom : 0),
                  // Short inline players (phone portrait): scroll the list
                  // instead of spilling past the picture, where Android
                  // would not deliver touches.
                  maxHeight: Math.max(
                    size.height -
                      POPOVER_BOTTOM -
                      (hasChapters ? CHAPTER_ROW_HEIGHT : 0) -
                      theme.spacing(2),
                    0,
                  ),
                },
                fullscreen && { right: theme.spacing(3) + insets.right },
              ]}
              rate={playbackRate}
              onSelect={(rate) => {
                onSelectRate(rate)
                setSpeedOpen(false)
                setInteraction((n) => n + 1)
              }}
            />
          )}
        </>
      )}

      {drawerOpen && fullscreen && (
        <ChapterDrawer
          chapters={chapters}
          bookmarks={bookmarks}
          currentChapter={chapterIndex}
          insets={insets}
          onSeek={(sec) => fromDrawer(() => onSeek(sec))}
          onOpenBookmark={(b) => fromDrawer(() => onOpenBookmark(b))}
          onShareMoment={onShareMoment}
          onClose={() => setDrawerOpen(false)}
          onAddChapterToPlan={onAddChapterToPlan}
          onAddBookmarkToPlan={onAddBookmarkToPlan}
        />
      )}

      {shownDrawing && !drawingMode && (
        <View
          style={[
            styles.drawingClose,
            {
              top:
                theme.spacing(2) +
                (fullscreen ? insets.top + (showControls ? TOP_BAR_HEIGHT : 0) : 0),
              right: theme.spacing(2) + (fullscreen ? insets.right : 0),
            },
          ]}
        >
          <ChipButton
            label="✕ Рисунок"
            accessibilityLabel="Скрыть рисунок"
            onPress={onHideDrawing}
          />
        </View>
      )}

      {drawingSeed && (
        <DrawingEditor
          rect={pictureRect}
          mirrored={mirrored}
          initialStrokes={drawingSeed.strokes}
          insets={fullscreen ? insets : NO_INSETS}
          onSave={(drawing) => {
            setDrawingSeed(null)
            onSaveDrawing(drawing, drawingSeed.bookmarkId)
          }}
          onCancel={() => setDrawingSeed(null)}
        />
      )}
    </View>
  )
}

function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"]
  label: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={
        active || disabled ? { selected: active, disabled } : undefined
      }
      hitSlop={6}
      style={[
        styles.iconButton,
        active && styles.active,
        disabled && styles.disabled,
      ]}
    >
      <Icon
        name={icon}
        size={22}
        color={active ? theme.colors.accentText : theme.colors.onOverlay}
      />
    </Pressable>
  )
}

function ChipButton({
  label,
  accessibilityLabel,
  onPress,
  active = false,
}: {
  label: string
  accessibilityLabel: string
  onPress: () => void
  active?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active ? { selected: true } : undefined}
      hitSlop={4}
      style={[styles.chip, active && styles.active]}
    >
      <Text style={[styles.chipText, active && styles.activeText]}>{label}</Text>
    </Pressable>
  )
}

// Also the compare screen's per-side seek bar.
export function SeekBar({
  time,
  duration,
  loopA,
  loopB,
  chapters,
  onScrub,
  onSeek,
}: {
  time: number
  duration: number | undefined
  loopA: number | null
  loopB: number | null
  chapters: ReadonlyArray<PlayerChapter>
  // Live position while dragging; null when the drag is cancelled.
  onScrub: (time: number | null) => void
  onSeek: (time: number) => void
}) {
  const styles = useThemedStyles(makeStyles)
  const [width, setWidth] = useState(0)
  // Track-relative x at touch-down plus the finger's travel since: robust
  // whatever the platform reports `locationX` against during a move.
  const origin = useRef({ x: 0, pageX: 0 })
  const at = (e: GestureResponderEvent) =>
    positionOnTrack(
      origin.current.x + e.nativeEvent.pageX - origin.current.pageX,
      width,
      duration,
    )
  const share = (t: number | null) =>
    t != null && duration ? `${(Math.min(t, duration) / duration) * 100}%` : null
  const progress = share(time) ?? "0%"
  const markA = share(loopA)
  const markB = share(loopB)

  return (
    <View
      style={styles.seekHit}
      collapsable={false}
      accessibilityRole="adjustable"
      accessibilityLabel="Позиция воспроизведения"
      accessibilityValue={{ text: formatPosition(time) }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !!duration}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        origin.current = { x: e.nativeEvent.locationX, pageX: e.nativeEvent.pageX }
        onScrub(at(e))
      }}
      onResponderMove={(e) => onScrub(at(e))}
      onResponderRelease={(e) => onSeek(at(e))}
      onResponderTerminate={() => onScrub(null)}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.trackFill, { width: progress }]} />
        {/* Chapter starts: dark notches cut into the track (A/B are tall
            light lines over it). One at 0:00 would mark nothing. */}
        {!!duration &&
          chapters.map((c) =>
            c.positionSec > 0 && c.positionSec < duration ? (
              <View
                key={c.id}
                style={[styles.chapterTick, { left: share(c.positionSec) ?? 0 }]}
              />
            ) : null,
          )}
      </View>
      {markA && <View style={[styles.loopMark, { left: markA }]} pointerEvents="none" />}
      {markB && <View style={[styles.loopMark, { left: markB }]} pointerEvents="none" />}
      <View style={[styles.thumb, { left: progress }]} pointerEvents="none" />
    </View>
  )
}

function SeekRipple({ feedback }: { feedback: SeekFeedback }) {
  const styles = useThemedStyles(makeStyles)
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    opacity.setValue(1)
    Animated.timing(opacity, {
      toValue: 0,
      duration: 650,
      useNativeDriver: true,
    }).start()
  }, [feedback.key, opacity])
  const seconds = Math.abs(feedback.total)
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        feedback.side === "left" ? styles.rippleLeft : styles.rippleRight,
        { opacity },
      ]}
    >
      <Text style={styles.rippleText}>
        {feedback.side === "left" ? `« ${seconds} с` : `${seconds} с »`}
      </Text>
    </Animated.View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    topBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingBottom: theme.spacing(2),
      backgroundColor: theme.colors.overlayStrong,
    },
    // The plan bar over an inline (not fullscreen) picture.
    planInline: {
      position: "absolute",
      top: theme.spacing(2),
      left: theme.spacing(2),
      right: theme.spacing(2),
      alignItems: "flex-start",
    },
    title: {
      flex: 1,
      color: theme.colors.onOverlay,
      fontSize: 16,
      fontWeight: "700",
    },
    centerRow: {
      ...StyleSheet.absoluteFill,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(6),
    },
    playButton: {
      width: PLAY_BUTTON_SIZE,
      height: PLAY_BUTTON_SIZE,
      borderRadius: PLAY_BUTTON_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.overlayStrong,
    },
    bottomBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: theme.spacing(3),
      paddingBottom: theme.spacing(2),
      backgroundColor: theme.colors.overlayStrong,
    },
    // Wraps on narrow fullscreen (phone portrait), where every tool is shown.
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    time: {
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    spacer: { flex: 1 },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.overlayStrong,
    },
    chip: {
      minHeight: 32,
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    active: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    activeText: { color: theme.colors.accentText },
    disabled: { opacity: 0.4 },
    chapterLabel: {
      height: CHAPTER_ROW_HEIGHT,
      lineHeight: CHAPTER_ROW_HEIGHT,
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontWeight: "600",
    },
    // While scrubbing it names the chapter under the thumb.
    chapterScrub: { fontWeight: "800" },
    chapterTick: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 3,
      marginLeft: -1.5,
      backgroundColor: theme.colors.playerBg,
    },
    seekHit: { height: 32, justifyContent: "center" },
    track: {
      height: 4,
      borderRadius: 2,
      overflow: "hidden",
      backgroundColor: theme.colors.overlaySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.onOverlay,
    },
    trackFill: { height: "100%", backgroundColor: theme.colors.accent },
    thumb: {
      position: "absolute",
      width: 14,
      height: 14,
      marginLeft: -7,
      borderRadius: 7,
      backgroundColor: theme.colors.accent,
    },
    loopMark: {
      position: "absolute",
      width: 2,
      height: 14,
      marginLeft: -1,
      backgroundColor: theme.colors.onOverlay,
    },
    speedPopover: { position: "absolute", right: theme.spacing(3) },
    drawingClose: {
      position: "absolute",
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.overlayStrong,
    },
    ripple: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: "33%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.overlaySoft,
    },
    rippleLeft: {
      left: 0,
      borderTopRightRadius: 9999,
      borderBottomRightRadius: 9999,
    },
    rippleRight: {
      right: 0,
      borderTopLeftRadius: 9999,
      borderBottomLeftRadius: 9999,
    },
    rippleText: {
      color: theme.colors.onOverlay,
      fontSize: 16,
      fontWeight: "700",
    },
  })
