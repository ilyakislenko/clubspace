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
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { BoostBadge } from "./BoostBadge"
import { formatPosition } from "./format-position"
import { PlaybackRatePopover } from "./PlaybackSpeedPicker"
import { clampSeek, frameStepTarget, positionOnTrack } from "./player-math"
import type { PlayerHandle } from "./player-types"
import { usePlayerGestures, type SeekFeedback } from "./use-player-gestures"

// Controls fade out this long after the last touch while playing.
const AUTO_HIDE_MS = 3500
const POLL_MS = 250
// While dragging the seek bar, seek the picture at most this often.
const SCRUB_SEEK_MS = 100
// The speed popover sits this far above the bottom edge (clear of the bar).
const POPOVER_BOTTOM = 96

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
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [speedOpen, setSpeedOpen] = useState(false)
  // Position under the finger while dragging the seek bar.
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(() => readSnapshot(player))
  // Bumped by every control press: restarts the auto-hide countdown.
  const [interaction, setInteraction] = useState(0)
  const [height, setHeight] = useState(0)
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
    if (!controlsVisible || !snapshot.playing || speedOpen || scrubTime != null) {
      return
    }
    const id = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS)
    return () => clearTimeout(id)
  }, [controlsVisible, snapshot.playing, speedOpen, scrubTime, interaction])

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

  const time = scrubTime ?? snapshot.time
  const loopSet = loopA != null || loopB != null
  const iconColor = theme.colors.onOverlay

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
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

      {controlsVisible && (
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
            </View>
          )}

          <View style={styles.centerRow} pointerEvents="box-none">
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
          >
            <SeekBar
              time={time}
              duration={snapshot.duration}
              loopA={loopA}
              loopB={loopB}
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
              <ChipButton
                label={`${playbackRate}x`}
                accessibilityLabel={`Скорость ${playbackRate}x, выбрать`}
                active={speedOpen}
                onPress={act(() => setSpeedOpen((v) => !v))}
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
                  bottom: POPOVER_BOTTOM + (fullscreen ? insets.bottom : 0),
                  // Short inline players (phone portrait): scroll the list
                  // instead of spilling past the picture, where Android
                  // would not deliver touches.
                  maxHeight: Math.max(
                    height - POPOVER_BOTTOM - theme.spacing(2),
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
    </View>
  )
}

function IconButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"]
  label: string
  onPress: () => void
  active?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={active ? { selected: true } : undefined}
      hitSlop={6}
      style={[styles.iconButton, active && styles.active]}
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

function SeekBar({
  time,
  duration,
  loopA,
  loopB,
  onScrub,
  onSeek,
}: {
  time: number
  duration: number | undefined
  loopA: number | null
  loopB: number | null
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
      width: 64,
      height: 64,
      borderRadius: 32,
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
