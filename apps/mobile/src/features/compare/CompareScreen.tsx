// «Сравнить рядом»: two clips side by side (stacked on a portrait phone) to
// compare details — the lesson against another angle, another instructor, a
// saved segment. Each side has its own seek bar and frame step, with mirror
// and A–B behind its «⋯». The bar below plays/pauses both and sets one slow
// speed for both; its «⋯» locks them together («Синхронно», keeping the
// offset they had) and picks whose sound plays. Both pictures are TextureView
// players (see use-player); expo-video releases them when the screen unmounts.
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useNetworkState } from "expo-network"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AppState,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { resolvePlayableLesson } from "../video/playable-source"
import { clampSeek, frameStepTarget } from "../video/player-math"
import type { PlayerHandle } from "../video/player-types"
import { usePlayer } from "../video/use-player"
import { ComparePane, IconAction, SmallButton, type PaneMedia } from "./ComparePane"
import { CompareOptionsSheet, ComparePaneSheet, CompareSpeedSheet } from "./CompareMenus"
import { ComparePicker } from "./ComparePicker"
import type { CompareClip } from "./compare-sources"
import {
  clampSegment,
  type CompareSide,
  driftCorrection,
  followerTarget,
  loopWrapTarget,
  otherSide,
  type Segment,
  syncOffset,
} from "./compare-sync"

type Props = NativeStackScreenProps<RootStackParamList, "Compare">

type BySide<T> = Record<CompareSide, T>
type Snapshot = { time: number; duration: number | undefined; playing: boolean }

const SIDES: readonly CompareSide[] = ["left", "right"]
const SIDE_LABEL: BySide<string> = { left: "Слева", right: "Справа" }
const POLL_MS = 200
// While dragging a seek bar, seek the pictures at most this often.
const SCRUB_SEEK_MS = 100

const snapshotOf = (player: PlayerHandle): Snapshot => ({
  time: player.currentTime,
  duration: player.duration,
  playing: player.playing,
})

// The same media keeps its player source: picking another clip of the lesson
// already on that side only seeks.
const mediaKey = (clip: CompareClip | null): string | null =>
  !clip
    ? null
    : clip.media.kind === "lesson"
      ? `lesson:${clip.media.videoId}`
      : `stream:${clip.key}`

export function CompareScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId ?? null
  const network = useNetworkState()
  const online = network.isConnected !== false && network.isInternetReachable !== false
  const { width, height } = useWindowDimensions()
  const landscape = width > height
  const { videoId, title, startAt, endAt } = route.params

  // The left side opens on the lesson the member came from, at its moment
  // (or its A–B segment).
  const [clips, setClips] = useState<BySide<CompareClip | null>>(() => ({
    left: {
      key: "initial",
      media: { kind: "lesson", videoId },
      title: title ?? "",
      startSec: startAt ?? 0,
      endSec: endAt ?? null,
    },
    right: null,
  }))
  const [media, setMedia] = useState<BySide<PaneMedia>>({
    left: { status: "loading" },
    right: { status: "empty" },
  })
  const [uris, setUris] = useState<BySide<string | null>>({ left: null, right: null })
  const [snap, setSnap] = useState<BySide<Snapshot>>({
    left: { time: 0, duration: undefined, playing: false },
    right: { time: 0, duration: undefined, playing: false },
  })
  const [scrub, setScrub] = useState<BySide<number | null>>({ left: null, right: null })
  const [mirrored, setMirrored] = useState<BySide<boolean>>({ left: false, right: false })
  const [loops, setLoops] = useState<BySide<Segment | null>>({ left: null, right: null })
  const [sync, setSync] = useState(false)
  const [rate, setRate] = useState(1)
  const [audioSide, setAudioSide] = useState<CompareSide>("left")
  const [pickerSide, setPickerSide] = useState<CompareSide | null>(null)
  // The open menu: the speed, the both-sides options, or one side's tools.
  const [menu, setMenu] = useState<"speed" | "options" | CompareSide | null>(null)

  // Where a freshly picked clip starts (applied once its video has loaded).
  const pending = useRef<BySide<Segment | null>>({
    left: { startSec: startAt ?? 0, endSec: endAt ?? null },
    right: null,
  })
  // The lock's offset (right − left), fixed when «Синхронно» is switched on.
  const offset = useRef(0)
  const syncRef = useRef(sync)
  syncRef.current = sync
  const loopsRef = useRef(loops)
  loopsRef.current = loops
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const lastScrubSeek = useRef(0)
  const urisRef = useRef(uris)
  urisRef.current = uris

  const left = usePlayer(uris.left)
  const right = usePlayer(uris.right)
  const players: BySide<PlayerHandle> = useMemo(
    () => ({ left: left.player, right: right.player }),
    [left.player, right.player],
  )

  const setSide = <T,>(
    set: React.Dispatch<React.SetStateAction<BySide<T>>>,
    side: CompareSide,
    value: NoInfer<T>,
  ) => set((prev) => ({ ...prev, [side]: value }))

  // A side's media: what to play and its details.
  const resolveSide = useCallback(
    (side: CompareSide) => {
      const clip = clipsRef.current[side]
      if (!clip || !workspaceId) {
        setMedia((m) => ({ ...m, [side]: { status: "empty" } }))
        setUris((u) => ({ ...u, [side]: null }))
        return
      }
      let cancelled = false
      // The old source goes first, so a picked start never lands on it.
      setUris((u) => ({ ...u, [side]: null }))
      setMedia((m) => ({ ...m, [side]: { status: "loading" } }))
      const run = async () => {
        if (clip.media.kind === "lesson") {
          const lesson = await resolvePlayableLesson(workspaceId, clip.media.videoId)
          return {
            uri: lesson.uri,
            title: lesson.video.title,
            chapters: lesson.video.timestamps,
            offline: lesson.offline,
          }
        }
        return {
          uri: await clip.media.resolveUri(),
          title: clip.media.title,
          chapters: [],
          offline: false,
        }
      }
      run()
        .then(({ uri, ...details }) => {
          if (cancelled) return
          setUris((u) => ({ ...u, [side]: uri }))
          setMedia((m) => ({ ...m, [side]: { status: "ready", ...details } }))
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setMedia((m) => ({
            ...m,
            [side]: {
              status: "error",
              message: errorMessage(err, "Не удалось открыть видео."),
            },
          }))
        })
      return () => {
        cancelled = true
      }
    },
    [workspaceId],
  )

  const leftKey = mediaKey(clips.left)
  const rightKey = mediaKey(clips.right)
  useEffect(() => resolveSide("left"), [resolveSide, leftKey])
  useEffect(() => resolveSide("right"), [resolveSide, rightKey])

  // One clock for both sides: picked starts, A–B loops, the lock's drift, and
  // the readouts.
  useEffect(() => {
    const id = setInterval(() => {
      const locked = syncRef.current
      for (const side of SIDES) {
        const player = players[side]
        const start = pending.current[side]
        const duration = player.duration
        if (!start || !urisRef.current[side] || !duration) continue
        const segment = clampSegment(start, duration)
        pending.current[side] = null
        player.currentTime = segment.startSec
        setLoops((l) => ({ ...l, [side]: segment.endSec != null ? segment : null }))
        // A new clip under the lock: lock it at its start.
        if (locked) {
          const other = players[otherSide(side)].currentTime
          offset.current =
            side === "left"
              ? syncOffset(segment.startSec, other)
              : syncOffset(other, segment.startSec)
        }
      }

      const { left: l, right: r } = players
      const current = loopsRef.current
      const leftWrap = loopWrapTarget(l.currentTime, current.left)
      if (leftWrap != null) {
        l.currentTime = leftWrap
        // Locked, the left loop drives both.
        if (locked) {
          r.currentTime = followerTarget("left", leftWrap, offset.current, r.duration)
        }
      }
      if (!locked) {
        const rightWrap = loopWrapTarget(r.currentTime, current.right)
        if (rightWrap != null) r.currentTime = rightWrap
      } else if (l.playing && r.playing) {
        const fix = driftCorrection(l.currentTime, r.currentTime, offset.current, r.duration)
        if (fix != null) r.currentTime = fix
      }

      setSnap({ left: snapshotOf(l), right: snapshotOf(r) })
    }, POLL_MS)
    return () => clearInterval(id)
  }, [players])

  // One speed and one sound for both; a new source starts from the defaults,
  // so re-apply when one loads.
  useEffect(() => {
    for (const side of SIDES) players[side].playbackRate = rate
  }, [players, rate, uris])
  useEffect(() => {
    for (const side of SIDES) players[side].muted = side !== audioSide
  }, [players, audioSide, uris])

  // Leaving the app (or this screen) stops both.
  useEffect(() => {
    const pauseBoth = () =>
      SIDES.forEach((side) => {
        try {
          players[side].pause()
        } catch {
          // Already released by expo-video on unmount.
        }
      })
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") pauseBoth()
    })
    return () => {
      sub.remove()
      pauseBoth()
    }
  }, [players])

  // A seek on one side; locked, the other moves by the same amount.
  const seekSide = (side: CompareSide, time: number) => {
    const player = players[side]
    const target = clampSeek(time, player.duration)
    player.currentTime = target
    if (syncRef.current) {
      const other = players[otherSide(side)]
      other.currentTime = followerTarget(side, target, offset.current, other.duration)
    }
  }

  const stepFrame = (side: CompareSide, direction: 1 | -1) => {
    const player = players[side]
    if (syncRef.current) SIDES.forEach((s) => players[s].pause())
    else player.pause()
    seekSide(
      side,
      frameStepTarget(player.currentTime, direction, player.frameRate, player.duration),
    )
  }

  const anyPlaying = snap.left.playing || snap.right.playing
  const togglePlay = () => {
    if (anyPlaying) {
      SIDES.forEach((side) => players[side].pause())
      return
    }
    if (sync && uris.right) {
      const { left: l, right: r } = players
      r.currentTime = followerTarget("left", l.currentTime, offset.current, r.duration)
    }
    SIDES.forEach((side) => {
      if (uris[side]) players[side].play()
    })
  }

  const toggleSync = () => {
    if (!sync) {
      offset.current = syncOffset(players.left.currentTime, players.right.currentTime)
    }
    setSync(!sync)
  }

  const setA = (side: CompareSide) => {
    const player = players[side]
    const t = player.currentTime
    setLoops((l) => {
      const end = l[side]?.endSec
      return {
        ...l,
        [side]: clampSegment(
          { startSec: t, endSec: end != null && end > t ? end : null },
          player.duration,
        ),
      }
    })
  }

  const setB = (side: CompareSide) => {
    const player = players[side]
    const t = player.currentTime
    const loop = loopsRef.current[side]
    if (!loop || t <= loop.startSec) {
      showAlert("Сначала отметьте точку A раньше точки B.")
      return
    }
    setSide(setLoops, side, clampSegment({ startSec: loop.startSec, endSec: t }, player.duration))
  }

  const pick = (side: CompareSide, clip: CompareClip) => {
    setPickerSide(null)
    pending.current[side] = { startSec: clip.startSec, endSec: clip.endSec }
    setSide(setLoops, side, null)
    setSide(setClips, side, clip)
  }

  const leftTitle = media.left.status === "ready" ? media.left.title : (title ?? "")
  const pickerContext = useMemo(
    () =>
      workspaceId
        ? { workspaceId, online, currentVideo: { id: videoId, title: leftTitle } }
        : null,
    [workspaceId, online, videoId, leftTitle],
  )

  const surfaces = { left: left.PlayerSurface, right: right.PlayerSurface }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
      <StatusBar hidden={landscape} animated />
      <View style={[styles.panes, landscape ? styles.row : styles.column]}>
        {SIDES.map((side) => (
          <ComparePane
            key={side}
            label={SIDE_LABEL[side]}
            clipTitle={clips[side]?.title}
            media={media[side]}
            PlayerSurface={surfaces[side]}
            time={scrub[side] ?? snap[side].time}
            duration={snap[side].duration}
            mirrored={mirrored[side]}
            audible={audioSide === side}
            loop={loops[side]}
            onPick={() => setPickerSide(side)}
            onScrub={(t) => {
              setSide(setScrub, side, t)
              const now = Date.now()
              if (t != null && now - lastScrubSeek.current >= SCRUB_SEEK_MS) {
                lastScrubSeek.current = now
                seekSide(side, t)
              }
            }}
            onSeek={(t) => {
              seekSide(side, t)
              setSide(setScrub, side, null)
            }}
            onStepFrame={(direction) => stepFrame(side, direction)}
            onMore={() => setMenu(side)}
          />
        ))}
      </View>

      <View style={styles.bar}>
        <IconAction icon="arrow-back" label="Назад" onPress={() => navigation.goBack()} />
        <IconAction
          icon={anyPlaying ? "pause" : "play"}
          label={anyPlaying ? "Пауза, обе стороны" : "Смотреть обе стороны"}
          onPress={togglePlay}
        />
        <SmallButton
          label={`${rate}x`}
          accessibilityLabel={`Скорость ${rate}x для обеих сторон, изменить`}
          onPress={() => setMenu("speed")}
        />
        <View style={styles.spacer} />
        <IconAction icon="ellipsis-horizontal" label="Ещё" onPress={() => setMenu("options")} />
      </View>

      {menu === "speed" && (
        <CompareSpeedSheet
          rate={rate}
          onSelect={(r) => {
            setRate(r)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === "options" && (
        <CompareOptionsSheet
          sync={sync}
          canSync={!!uris.right}
          leftLoopLeads={loops.left?.endSec != null}
          audioSide={audioSide}
          onToggleSync={() => {
            toggleSync()
            setMenu(null)
          }}
          onAudioSide={(side) => {
            setAudioSide(side)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {(menu === "left" || menu === "right") && (
        <ComparePaneSheet
          label={SIDE_LABEL[menu]}
          mirrored={mirrored[menu]}
          loop={loops[menu]}
          onToggleMirror={() => {
            setSide(setMirrored, menu, !mirrored[menu])
            setMenu(null)
          }}
          onSetA={() => {
            setA(menu)
            setMenu(null)
          }}
          onSetB={() => {
            setB(menu)
            setMenu(null)
          }}
          onClearLoop={() => {
            setSide(setLoops, menu, null)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {pickerSide && pickerContext && (
        <ComparePicker
          title={`${SIDE_LABEL[pickerSide]}: с чем сравнить`}
          context={pickerContext}
          onSelect={(clip) => pick(pickerSide, clip)}
          onClose={() => setPickerSide(null)}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.playerBg },
    panes: { flex: 1, gap: theme.spacing(1) },
    row: { flexDirection: "row" },
    column: { flexDirection: "column" },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      backgroundColor: theme.colors.overlayStrong,
    },
    spacer: { flex: 1 },
  })
