"use client"

import Hls from "hls.js"
import { useEffect, useRef } from "react"

type PlyrPlayerProps = {
  src: string
  poster?: string | null
  title?: string
  autoPlay?: boolean
}

export function PlyrPlayer({
  src,
  poster,
  title = "Видео",
  autoPlay = false,
}: PlyrPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<unknown | null>(null)
  const hlsRef = useRef<Hls | null>(null)

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
        hls.on(Hls.Events.MANIFEST_LOADING, () =>
          console.log("[hls] manifest loading")
        )
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) =>
          console.log("[hls] manifest parsed", { levels: data.levels?.length })
        )
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) =>
          console.log("[hls] level switched", data.level)
        )
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
