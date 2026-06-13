"use client"

import Hls from "hls.js"
import { useEffect, useRef } from "react"

export type PlaybackProgress = {
  position: number
  duration: number
  completed: boolean
}

type PlyrPlayerProps = {
  src: string
  poster?: string | null
  title?: string
  autoPlay?: boolean
  onProgress?: (progress: PlaybackProgress) => void
}

export function PlyrPlayer({
  src,
  poster,
  title = "Video",
  autoPlay = false,
  onProgress,
}: PlyrPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<unknown | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  // Keep the latest callback in a ref so the heavy setup effect doesn't
  // re-run (and tear down the player) when the parent passes a new closure.
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  useEffect(() => {
    let isCancelled = false
    const video = videoRef.current
    if (!video || !src) return

    // Report watch progress so coach-side stats see web viewers too: a
    // throttled timeupdate, the current position on pause, and completion
    // on ended. Listeners are removed in cleanup.
    const durationOf = () => (Number.isFinite(video.duration) ? video.duration : 0)
    let lastReported = 0
    const handleTimeUpdate = () => {
      if (video.currentTime - lastReported < 10) return
      lastReported = video.currentTime
      onProgressRef.current?.({
        position: video.currentTime,
        duration: durationOf(),
        completed: false,
      })
    }
    const handlePause = () => {
      onProgressRef.current?.({
        position: video.currentTime,
        duration: durationOf(),
        completed: false,
      })
    }
    const handleEnded = () => {
      onProgressRef.current?.({
        position: durationOf(),
        duration: durationOf(),
        completed: true,
      })
    }
    video.addEventListener("timeupdate", handleTimeUpdate)
    video.addEventListener("pause", handlePause)
    video.addEventListener("ended", handleEnded)

    hlsRef.current?.destroy()
    hlsRef.current = null
    if (
      playerRef.current &&
      typeof (playerRef.current as { destroy?: () => void }).destroy ===
        "function"
    ) {
      ;(playerRef.current as { destroy: () => void }).destroy()
    }
    playerRef.current = null

    if (poster) video.poster = poster

    const setup = async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src
      } else if (Hls.isSupported() && src.includes(".m3u8")) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(src)
        hls.attachMedia(video)
      } else {
        video.src = src
      }

      const plyrModule = await import("plyr")
      const PlyrCtor = plyrModule.default ?? plyrModule
      if (isCancelled) return

      const player = new PlyrCtor(video, {
        controls: [
          "play",
          "progress",
          "current-time",
          "mute",
          "volume",
          "settings",
          "pip",
          "fullscreen",
        ],
        settings: ["speed", "quality"],
        autoplay: autoPlay,
        keyboard: { focused: true, global: false },
        seekTime: 5,
        // Plyr v3.8 types don't list iconUrl/blankVideo, but they are valid runtime options.
        ...({
          iconUrl: "https://cdn.plyr.io/3.8.4/plyr.svg",
          blankVideo: "https://cdn.plyr.io/static/blank.mp4",
        } as Record<string, unknown>),
      })
      playerRef.current = player

      if (autoPlay) {
        void video.play().catch(() => undefined)
      }
    }

    void setup()

    return () => {
      isCancelled = true
      video.removeEventListener("timeupdate", handleTimeUpdate)
      video.removeEventListener("pause", handlePause)
      video.removeEventListener("ended", handleEnded)
      if (
        playerRef.current &&
        typeof (playerRef.current as { destroy?: () => void }).destroy ===
          "function"
      ) {
        ;(playerRef.current as { destroy: () => void }).destroy()
      }
      playerRef.current = null
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [src, autoPlay])

  return (
    <div className="overflow-hidden rounded-md bg-black">
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="plyr w-full"
        title={title}
      />
    </div>
  )
}
