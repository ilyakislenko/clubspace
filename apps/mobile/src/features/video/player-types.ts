import type { ComponentType } from "react"
import type { StyleProp, ViewStyle } from "react-native"

// A tiny player interface shared by the native (expo-video) and web (Plyr)
// implementations, resolved per-platform via `use-player.tsx` /
// `use-player.web.tsx`. It exposes only what VideoScreen actually drives:
// read/seek position, read duration, set speed, play, and a "reached the end"
// event (mapped to the DOM `ended` event on web).
export type PlayerHandle = {
  currentTime: number
  readonly duration: number | undefined
  playbackRate: number
  play: () => void
  addListener: (event: "playToEnd", cb: () => void) => { remove: () => void }
}

export type PlayerSurfaceProps = {
  style?: StyleProp<ViewStyle>
  contentFit?: "contain" | "cover" | "fill"
}

export type UsePlayerResult = {
  player: PlayerHandle
  // The element that actually renders the video (expo VideoView / Plyr <video>).
  PlayerSurface: ComponentType<PlayerSurfaceProps>
}
