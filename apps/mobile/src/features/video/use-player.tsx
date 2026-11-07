import { useEvent } from "expo"
import { useVideoPlayer, VideoView } from "expo-video"
import React, { useMemo } from "react"
import { StyleSheet } from "react-native"

import type {
  PlayerHandle,
  PlayerSurfaceProps,
  UsePlayerResult,
} from "./player-types"

// Native player: expo-video. The web build resolves `use-player.web.tsx`
// instead, so this file (and expo-video) never runs on web.
//
// The view is a bare picture — no native controls; PlayerOverlay draws them
// (see the note there). It renders into a TextureView rather than the default
// SurfaceView: a SurfaceView is composited outside the view hierarchy and
// ignores view transforms, so the mirror flip (scaleX: -1) only works on a
// TextureView. Seeks stay at expo-video's default zero seek tolerance (exact),
// which the frame step relies on.
export function usePlayer(uri: string | null): UsePlayerResult {
  const player = useVideoPlayer(uri ?? null, (instance) => {
    instance.loop = false
    instance.timeUpdateEventInterval = 1
  })

  const handle = useMemo<PlayerHandle>(
    () => ({
      get currentTime() {
        return player.currentTime
      },
      set currentTime(t: number) {
        player.currentTime = t
      },
      get duration() {
        const d = player.duration
        return Number.isFinite(d) && d > 0 ? d : undefined
      },
      get frameRate() {
        return player.videoTrack?.frameRate ?? null
      },
      get playbackRate() {
        return player.playbackRate
      },
      set playbackRate(r: number) {
        player.playbackRate = r
      },
      get playing() {
        return player.playing
      },
      play: () => player.play(),
      pause: () => player.pause(),
      addListener: (event, cb) => player.addListener(event, cb),
    }),
    [player],
  )

  const PlayerSurface = useMemo(
    () =>
      function PlayerSurface({
        style,
        contentFit = "contain",
        mirrored = false,
      }: PlayerSurfaceProps) {
        return (
          <VideoView
            player={player}
            style={[style, mirrored && styles.mirrored]}
            contentFit={contentFit}
            nativeControls={false}
            surfaceType="textureView"
          />
        )
      },
    [player],
  )

  const { status } = useEvent(player, "statusChange", { status: player.status })

  return {
    player: handle,
    PlayerSurface,
    failed: status === "error",
    builtInControls: false,
  }
}

const styles = StyleSheet.create({
  mirrored: { transform: [{ scaleX: -1 }] },
})
