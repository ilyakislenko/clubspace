import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import type { ReviewDrawing, VideoReviewComment } from "../../shared/api/video-reviews"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { DrawingCanvas } from "../video/DrawingCanvas"
import { DrawingEditor } from "../video/DrawingEditor"
import { containRect, SHOWN_DRAWING_DRIFT_SEC, type Size } from "../video/drawing-math"
import { formatPosition } from "../video/format-position"
import { SeekBar } from "../video/PlayerOverlay"
import type { PlayerHandle } from "../video/player-types"
import { usePlayer } from "../video/use-player"

const POLL_MS = 250
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

export type CommentFocus = { commentId: string; nonce: number }

export type DrawingEditing = {
  initialStrokes: ReviewDrawing["strokes"]
  onSave: (drawing: ReviewDrawing | null) => void
  onCancel: () => void
}

type Props = {
  uri: string | null
  comments: readonly VideoReviewComment[]
  // A tapped comment: seek there; a comment with a drawing pauses on its frame
  // and shows the drawing until the picture moves on.
  focus: CommentFocus | null
  // A coach drawing for a comment: the editor covers the picture.
  editing: DrawingEditing | null
  onPlayer: (player: PlayerHandle) => void
}

type Snapshot = { time: number; duration: number | undefined; playing: boolean }

// The member's clip with the coach's comments as seek-bar marks. Reuses the
// lesson player's pieces (the player, the seek bar, the drawing layer) without
// the lesson tools — no bookmarks, A–B or study plans on someone's own clip.
export function ReviewPlayer({ uri, comments, focus, editing, onPlayer }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { player, PlayerSurface, failed, builtInControls } = usePlayer(uri)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [snapshot, setSnapshot] = useState<Snapshot>({
    time: 0,
    duration: undefined,
    playing: false,
  })
  const [scrub, setScrub] = useState<number | null>(null)
  const [shown, setShown] = useState<{ atSec: number; drawing: ReviewDrawing } | null>(null)

  useEffect(() => onPlayer(player), [player, onPlayer])

  const refresh = useCallback(
    () =>
      setSnapshot({
        time: player.currentTime,
        duration: player.duration,
        playing: player.playing,
      }),
    [player],
  )
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  // A tapped comment.
  const focusNonce = focus?.nonce
  useEffect(() => {
    if (!focus) return
    const comment = comments.find((c) => c.id === focus.commentId)
    if (!comment) return
    player.currentTime = comment.atSec
    if (comment.drawing) {
      player.pause()
      setShown({ atSec: comment.atSec, drawing: comment.drawing })
    } else {
      setShown(null)
      player.play()
    }
    refresh()
    // Re-run per tap (the nonce), not per comments refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  // A shown drawing belongs to its frame: gone on play or once the picture
  // moved away from it.
  useEffect(() => {
    if (!shown) return
    if (snapshot.playing || Math.abs(snapshot.time - shown.atSec) > SHOWN_DRAWING_DRIFT_SEC) {
      setShown(null)
    }
  }, [shown, snapshot])

  const rect = useMemo(() => containRect(size, player.videoSize), [size, player.videoSize])
  const markers = useMemo(
    () => comments.map((c) => ({ id: c.id, positionSec: c.atSec, title: c.text })),
    [comments],
  )

  const togglePlay = () => {
    if (player.playing) player.pause()
    else {
      const { duration } = player
      if (duration && player.currentTime >= duration - 0.25) player.currentTime = 0
      player.play()
    }
    refresh()
  }

  const time = scrub ?? snapshot.time
  return (
    <View
      style={styles.box}
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      <PlayerSurface style={StyleSheet.absoluteFill} contentFit="contain" />
      {shown && !editing && (
        <DrawingCanvas strokes={shown.drawing.strokes} rect={rect} mirrored={false} />
      )}
      {failed && (
        <View style={styles.failed}>
          <Text style={styles.failedText}>Не удалось воспроизвести видео</Text>
        </View>
      )}
      {editing ? (
        <DrawingEditor
          rect={rect}
          mirrored={false}
          initialStrokes={editing.initialStrokes}
          insets={NO_INSETS}
          onSave={editing.onSave}
          onCancel={editing.onCancel}
        />
      ) : (
        !builtInControls && (
          <View style={styles.controls}>
            <Pressable
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={snapshot.playing ? "Пауза" : "Смотреть"}
              hitSlop={8}
              style={styles.play}
            >
              <Icon
                name={snapshot.playing ? "pause" : "play"}
                size={22}
                color={theme.colors.onOverlay}
              />
            </Pressable>
            <View style={styles.seek}>
              <SeekBar
                time={time}
                duration={snapshot.duration}
                loopA={null}
                loopB={null}
                chapters={markers}
                onScrub={setScrub}
                onSeek={(t) => {
                  player.currentTime = t
                  setScrub(null)
                  refresh()
                }}
              />
            </View>
            <Text style={styles.time}>
              {formatPosition(time)}
              {snapshot.duration ? ` / ${formatPosition(snapshot.duration)}` : ""}
            </Text>
          </View>
        )
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    box: {
      width: "100%",
      aspectRatio: 16 / 9,
      maxHeight: 520,
      backgroundColor: theme.colors.playerBg,
      borderRadius: theme.radius.md,
      overflow: "hidden",
    },
    controls: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(2),
      paddingVertical: theme.spacing(1),
      backgroundColor: theme.colors.overlaySoft,
    },
    play: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    seek: { flex: 1 },
    time: {
      color: theme.colors.onOverlay,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
    },
    failed: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    failedText: { color: theme.colors.onOverlay, fontSize: 14 },
  })
