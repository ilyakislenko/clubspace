/// <reference lib="dom" />
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { isOfflineUrl } from "../offline/offline-media-cache"
import { OfflineCacheLoader } from "./offline-hls-loader"
import { PLAYBACK_RATES } from "./player-math"
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
  const [failed, setFailed] = useState(false)
  const rateRef = useRef(1)
  const mutedRef = useRef(false)

  const attachRef = useCallback((el: HTMLVideoElement | null) => {
    elRef.current = el
    if (el) el.muted = mutedRef.current
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
      // The DOM exposes no frame rate; the frame step falls back to 30 fps.
      frameRate: null,
      get videoSize() {
        const v = elRef.current
        return v && v.videoWidth > 0
          ? { width: v.videoWidth, height: v.videoHeight }
          : null
      },
      // The element's own rate: Plyr's speed menu changes it behind our back.
      get playbackRate() {
        return elRef.current?.playbackRate ?? rateRef.current
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
      get playing() {
        const v = elRef.current
        return !!v && !v.paused && !v.ended
      },
      // Kept for an element attached later (Plyr mounts it after the handle).
      get muted() {
        return elRef.current?.muted ?? mutedRef.current
      },
      set muted(m: boolean) {
        mutedRef.current = m
        if (elRef.current) elRef.current.muted = m
      },
      play() {
        void elRef.current?.play().catch(() => undefined)
      },
      pause() {
        elRef.current?.pause()
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
    setFailed(false)

    let destroyed = false
    let plyr: { destroy: () => void } | null = null
    let hls: { destroy: () => void } | null = null

    let sourceAttached: Promise<void>
    if (isOfflineUrl(uri)) {
      // A downloaded lesson: its HLS playlist and segments sit in Cache
      // Storage, and hls.js reads them through OfflineCacheLoader (no
      // network, no service worker needed). Streaming below is untouched.
      // iOS's ManagedMediaSource only plays when AirPlay is off for the element.
      video.disableRemotePlayback = true
      sourceAttached = import("hls.js").then(({ default: Hls }) => {
        if (destroyed) return
        const instance = new Hls({ loader: OfflineCacheLoader })
        hls = instance
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn("[player] offline playback failed", data.details)
            setFailed(true)
          }
        })
        instance.loadSource(uri)
        instance.attachMedia(video)
      })
    } else {
      video.disableRemotePlayback = false
      video.src = uri
      sourceAttached = Promise.resolve()
    }

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
    const onError = () => setFailed(true)
    video.addEventListener("loadedmetadata", applyPending)
    video.addEventListener("ended", onEnded)
    video.addEventListener("error", onError)

    void sourceAttached
      .then(() => import("plyr"))
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
          speed: { selected: 1, options: [...PLAYBACK_RATES] },
          keyboard: { focused: true, global: false, seekTime: 5 },
          // Local sprite (bundled) — no CDN. blankVideo is what destroy()
          // loads to cancel the stream; Plyr's default is on its CDN, which
          // the PWA's CSP (deploy/pwa.Caddyfile) does not allow.
          iconUrl: "/vendor/plyr.svg",
          blankVideo: "/blank.mp4",
        })
      })
      .catch(() => undefined)

    return () => {
      destroyed = true
      video.removeEventListener("loadedmetadata", applyPending)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("error", onError)
      try {
        plyr?.destroy()
      } catch {
        /* ignore */
      }
      hls?.destroy()
    }
  }, [videoEl, uri])

  const PlayerSurface = useMemo(
    () =>
      // Raw DOM <video> (react-native-web runs on ReactDOM, so host elements are
      // fine). No crossOrigin, so the presigned progressive MP4 needs no S3 CORS.
      function PlayerSurface({ mirrored = false }: PlayerSurfaceProps) {
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
              // Plyr's controls are siblings of the <video>, so only the
              // picture flips.
              transform: mirrored ? "scaleX(-1)" : undefined,
            }}
          />
        )
      },
    [attachRef],
  )

  return { player, PlayerSurface, failed, builtInControls: true }
}
