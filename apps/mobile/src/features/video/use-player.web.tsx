/// <reference lib="dom" />
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  PlayerHandle,
  PlayerSurfaceProps,
  UsePlayerResult,
} from "./player-types"

// Plyr's stylesheet, bundled locally by scripts/build-pwa.mjs (no CDN — works
// offline and can't be blocked), plus a few rules so the player fills our
// fixed-size container and letterboxes portrait clips. Injected once, lazily.
let assetsInjected = false
const ensurePlyrAssets = () => {
  if (assetsInjected || typeof document === "undefined") return
  assetsInjected = true
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = "/vendor/plyr.css"
  document.head.appendChild(link)
  const style = document.createElement("style")
  style.textContent = [
    ".plyr{width:100%;height:100%;}",
    ".plyr__video-wrapper{height:100%;background:#000;}",
    ".plyr--video{height:100%;background:#000;}",
    ".plyr video{width:100%;height:100%;object-fit:contain;}",
  ].join("")
  document.head.appendChild(style)
}

export function usePlayer(uri: string | null): UsePlayerResult {
  const elRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const endCbs = useRef(new Set<() => void>())
  const pendingSeek = useRef<number | null>(null)
  const rateRef = useRef(1)

  const attachRef = useCallback((el: HTMLVideoElement | null) => {
    elRef.current = el
    setVideoEl(el)
  }, [])

  // Stable handle. Getters/setters proxy straight to the live <video>; seeks
  // before metadata is ready are queued and applied on `loadedmetadata`.
  const player = useMemo<PlayerHandle>(
    () => ({
      get currentTime() {
        return elRef.current?.currentTime ?? 0
      },
      set currentTime(t: number) {
        const v = elRef.current
        if (v && v.readyState >= 1 && Number.isFinite(v.duration)) {
          try {
            v.currentTime = t
          } catch {
            /* seek rejected — ignore */
          }
        } else {
          pendingSeek.current = t
        }
      },
      get duration() {
        const d = elRef.current?.duration
        return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined
      },
      get playbackRate() {
        return rateRef.current
      },
      set playbackRate(r: number) {
        rateRef.current = r
        const v = elRef.current
        if (v) {
          try {
            v.playbackRate = r
          } catch {
            /* ignore */
          }
        }
      },
      play() {
        void elRef.current?.play().catch(() => undefined)
      },
      addListener(event, cb) {
        if (event !== "playToEnd") return { remove: () => undefined }
        endCbs.current.add(cb)
        return {
          remove: () => {
            endCbs.current.delete(cb)
          },
        }
      },
    }),
    [],
  )

  // Load the source + attach Plyr whenever the element or uri changes.
  useEffect(() => {
    const video = videoEl
    if (!video || !uri) return
    ensurePlyrAssets()
    video.src = uri

    let destroyed = false
    let plyr: { destroy: () => void } | null = null

    const applyPending = () => {
      if (pendingSeek.current != null) {
        try {
          video.currentTime = pendingSeek.current
        } catch {
          /* ignore */
        }
        pendingSeek.current = null
      }
      try {
        video.playbackRate = rateRef.current
      } catch {
        /* ignore */
      }
    }
    const onEnded = () => {
      endCbs.current.forEach((cb) => cb())
    }
    video.addEventListener("loadedmetadata", applyPending)
    video.addEventListener("ended", onEnded)

    void import("plyr")
      .then((mod) => {
        if (destroyed) return
        const PlyrCtor = ((mod as { default?: unknown }).default ??
          mod) as new (
          el: unknown,
          opts?: Record<string, unknown>,
        ) => { destroy: () => void }
        plyr = new PlyrCtor(video, {
          controls: [
            "play-large",
            "play",
            "progress",
            "current-time",
            "mute",
            "volume",
            "settings",
            "pip",
            "fullscreen",
          ],
          settings: ["speed"],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
          keyboard: { focused: true, global: false, seekTime: 5 },
          // Local sprite (bundled) — no CDN. blankVideo is never fetched because
          // we always set video.src before init, so we leave it at its default.
          iconUrl: "/vendor/plyr.svg",
        })
      })
      .catch(() => undefined)

    return () => {
      destroyed = true
      video.removeEventListener("loadedmetadata", applyPending)
      video.removeEventListener("ended", onEnded)
      try {
        plyr?.destroy()
      } catch {
        /* ignore */
      }
    }
  }, [videoEl, uri])

  const PlayerSurface = useMemo(
    () =>
      // Raw DOM <video> (react-native-web runs on ReactDOM, so host elements are
      // fine). No crossOrigin, so the presigned progressive MP4 needs no S3 CORS.
      function PlayerSurface(_props: PlayerSurfaceProps) {
        return (
          <video
            ref={attachRef}
            playsInline
            preload="metadata"
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#000",
              display: "block",
            }}
          />
        )
      },
    [attachRef],
  )

  return { player, PlayerSurface }
}
