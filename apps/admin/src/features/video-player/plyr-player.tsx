"use client"

import Hls from "hls.js"
import { useEffect, useImperativeHandle, useRef, type Ref } from "react"

// Moves the player to a moment (a review comment's second).
export type PlyrPlayerHandle = { seek: (sec: number) => void }

type PlyrPlayerProps = {
  src: string
  poster?: string | null
  title?: string
  autoPlay?: boolean
  // The current second while it plays or seeks (whole seconds, deduplicated).
  onTimeUpdate?: (sec: number) => void
  ref?: Ref<PlyrPlayerHandle>
}

export function PlyrPlayer({
  src,
  poster,
  title = "Видео",
  autoPlay = false,
  onTimeUpdate,
  ref,
}: PlyrPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<unknown | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  // Read through a ref, so an inline callback doesn't re-subscribe.
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate

  useImperativeHandle(
    ref,
    () => ({
      seek: (sec: number) => {
        const video = videoRef.current
        if (video) video.currentTime = Math.max(0, sec)
      },
    }),
    [],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let last = -1
    const report = () => {
      const sec = Math.floor(video.currentTime)
      if (sec === last) return
      last = sec
      onTimeUpdateRef.current?.(sec)
    }
    video.addEventListener("timeupdate", report)
    video.addEventListener("seeked", report)
    return () => {
      video.removeEventListener("timeupdate", report)
      video.removeEventListener("seeked", report)
    }
  }, [])


  useEffect(() => {
    let isCancelled = false
    const video = videoRef.current
    if (!video || !src) {
      return
    }

    hlsRef.current?.destroy()
    hlsRef.current = null
    if (playerRef.current && typeof (playerRef.current as { destroy?: () => void }).destroy === "function") {
      ;(playerRef.current as { destroy: () => void }).destroy()
    }
    playerRef.current = null

    if (poster) {
      video.poster = poster
    }

    const setup = async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src
      } else if (Hls.isSupported() && src.includes(".m3u8")) {
        const hls = new Hls()
        hlsRef.current = hls
        // Only errors are logged. The manifest/level-switch traces were
        // upload-debugging aids and fired on every play in production.
        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.error("[hls] error", data)
        })
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
        keyboard: { focused: true, global: false, seekTime: 5 },
        // Plyr v3.8 types don't list iconUrl/blankVideo, but they are valid runtime options.
        // Both served from public/vendor, not Plyr's CDN, which the CSP
        // (src/proxy.ts) does not allow; blankVideo is what destroy() loads.
        ...({
          iconUrl: "/vendor/plyr.svg",
          blankVideo: "/vendor/blank.mp4",
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
      if (playerRef.current && typeof (playerRef.current as { destroy?: () => void }).destroy === "function") {
        ;(playerRef.current as { destroy: () => void }).destroy()
      }
      playerRef.current = null
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [src, autoPlay])

  return (
    <div className="overflow-hidden rounded-md">
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="plyr w-full p-0 bg-white"
        title={title}
      />
    </div>
  )
}
