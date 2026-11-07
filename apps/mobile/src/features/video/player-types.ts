import type { ComponentType } from "react"
import type { StyleProp, ViewStyle } from "react-native"

// A tiny player interface shared by the native (expo-video) and web (Plyr)
// implementations, resolved per-platform via `use-player.tsx` /
// `use-player.web.tsx`. It exposes only what VideoScreen and the player
// overlay actually drive: read/seek position, read duration and frame rate,
// set speed, play/pause, and a "reached the end" event (mapped to the DOM
// `ended` event on web).
export type PlayerHandle = {
  currentTime: number
  readonly duration: number | undefined
  // Frames per second of the current video track; null when unknown.
  readonly frameRate: number | null
  playbackRate: number
  readonly playing: boolean
  play: () => void
  pause: () => void
  addListener: (event: "playToEnd", cb: () => void) => { remove: () => void }
}

export type PlayerSurfaceProps = {
  style?: StyleProp<ViewStyle>
  contentFit?: "contain" | "cover" | "fill"
  // Flip the picture horizontally (only the picture, never any controls).
  mirrored?: boolean
}

export type UsePlayerResult = {
  player: PlayerHandle
  // The element that actually renders the video (expo VideoView / Plyr <video>).
  PlayerSurface: ComponentType<PlayerSurfaceProps>
  // The current source failed to load or decode (player error state).
  failed: boolean
  // true = the surface brings its own controls (Plyr on web); false = the
  // bare picture (native), which VideoScreen covers with PlayerOverlay.
  builtInControls: boolean
}
