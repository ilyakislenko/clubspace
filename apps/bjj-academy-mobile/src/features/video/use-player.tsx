import { useVideoPlayer, VideoView } from "expo-video"
import React, { useMemo } from "react"

import type {
  PlayerHandle,
  PlayerSurfaceProps,
  UsePlayerResult,
} from "./player-types"

// Native player: expo-video, exactly as before. The web build resolves
// `use-player.web.tsx` instead, so this file (and expo-video) never runs on web.
export function usePlayer(uri: string | null): UsePlayerResult {
  const player = useVideoPlayer(uri ?? null, (instance) => {
    instance.loop = false
    instance.timeUpdateEventInterval = 1
  })

  const PlayerSurface = useMemo(
    () =>
      function PlayerSurface({ style, contentFit = "contain" }: PlayerSurfaceProps) {
        return <VideoView player={player} style={style} contentFit={contentFit} />
      },
    [player],
  )

  return { player: player as unknown as PlayerHandle, PlayerSurface }
}
