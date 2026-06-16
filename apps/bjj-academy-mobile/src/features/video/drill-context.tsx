import {
  type AudioPlayer,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio"
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Vibration } from "react-native"

import {
  type DrillConfig,
  getDrillConfig,
  setDrillConfig,
} from "../profile/preferences-store"

export type Phase = "idle" | "prep" | "work" | "rest" | "done"

export const formatClock = (sec: number): string => {
  const safe = Math.max(0, Math.ceil(sec))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const replay = (p: AudioPlayer | null) => {
  if (!p) return
  try {
    void p.seekTo(0)
    p.play()
  } catch {
    /* noop — audio failures shouldn't break the timer */
  }
}

// Drill state and actions live in a context provider so the timer keeps
// running and emitting cues even when the bottom-sheet UI is hidden. The
// view layer (modal, FAB, in-video chip) is a stateless reflection of this
// state — closing or re-opening any of them never disturbs the round.
export type DrillContextValue = {
  config: DrillConfig
  phase: Phase
  round: number
  remaining: number
  paused: boolean
  setConfig: (config: DrillConfig) => void
  start: (config?: DrillConfig) => void
  stop: () => void
  togglePause: () => void
  skipRest: () => void
}

const DrillContext = createContext<DrillContextValue | null>(null)

export function useDrill(): DrillContextValue {
  const ctx = useContext(DrillContext)
  if (!ctx) {
    throw new Error("useDrill must be used inside <DrillProvider>")
  }
  return ctx
}

export const isDrillRunning = (phase: Phase): boolean =>
  phase === "prep" || phase === "work" || phase === "rest"

export function DrillProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<DrillConfig>({
    rounds: 3,
    workSec: 300,
    restSec: 30,
  })
  const [phase, setPhase] = useState<Phase>("idle")
  const [round, setRound] = useState(1)
  const [remaining, setRemaining] = useState(0)
  const [paused, setPaused] = useState(false)

  // Refs follow the live state so the single setInterval doesn't need to be
  // torn down and re-created on every state transition (which would skew
  // timing because setInterval drift compounds with the recreation).
  const phaseRef = useRef<Phase>("idle")
  const roundRef = useRef(1)
  const remainingRef = useRef(0)
  const pausedRef = useRef(false)
  const configRef = useRef(config)

  const startSfx = useAudioPlayer(
    require("../../../assets/sounds/round-start.wav"),
  )
  const endSfx = useAudioPlayer(
    require("../../../assets/sounds/round-end.wav"),
  )
  const tickSfx = useAudioPlayer(require("../../../assets/sounds/tick.wav"))
  const blipSfx = useAudioPlayer(require("../../../assets/sounds/blip.wav"))

  useEffect(() => {
    void getDrillConfig().then(setConfigState)
    // Mix with the video's audio rather than ducking or interrupting it, and
    // honour the iPhone silent switch the way a workout app would: a coach
    // tapping "drill" on a quiet floor still gets the cues.
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    }).catch(() => {
      /* setting audio mode is best-effort */
    })
  }, [])

  useEffect(() => {
    configRef.current = config
  }, [config])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    roundRef.current = round
  }, [round])
  useEffect(() => {
    remainingRef.current = remaining
  }, [remaining])
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const advance = useCallback(() => {
    const next = phaseRef.current
    if (next === "work") {
      replay(endSfx)
      Vibration.vibrate(200)
      if (roundRef.current >= configRef.current.rounds) {
        setPhase("done")
        return
      }
      setPhase("rest")
      setRemaining(configRef.current.restSec)
      return
    }
    if (next === "rest") {
      replay(startSfx)
      Vibration.vibrate(400)
      setRound((r) => r + 1)
      setPhase("work")
      setRemaining(configRef.current.workSec)
      return
    }
    if (next === "prep") {
      replay(startSfx)
      Vibration.vibrate(400)
      setPhase("work")
      setRemaining(configRef.current.workSec)
      return
    }
  }, [endSfx, startSfx])

  // Single 1Hz tick keeps the timer simple and accurate enough for class use.
  // We avoid wall-clock drift correction since rounds are minutes long and
  // ±1s over a 5-minute round is invisible to a drilling student.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return
    const id = setInterval(() => {
      if (pausedRef.current) return
      const next = remainingRef.current - 1
      // Tick during the last 3 seconds of work/rest, and on every second of
      // the 3-second prep — same countdown cue the gym wall clock gives.
      if (
        next > 0 &&
        (phaseRef.current === "prep" ||
          ((phaseRef.current === "work" || phaseRef.current === "rest") &&
            next <= 3))
      ) {
        replay(tickSfx)
      }
      if (next <= 0) {
        advance()
      } else {
        setRemaining(next)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase, advance, tickSfx])

  const setConfig = useCallback((nextConfig: DrillConfig) => {
    setConfigState(nextConfig)
  }, [])

  const start = useCallback(
    (override?: DrillConfig) => {
      const nextConfig = override ?? configRef.current
      if (override) setConfigState(override)
      void setDrillConfig(nextConfig)
      setRound(1)
      setPhase("prep")
      setRemaining(3)
      setPaused(false)
      // Fire a tick for the leading "3" beat — the interval delivers the
      // next tick a second later for "2", then "1", and the round-start cue
      // lands on "GO". Without this the user would see "3" silently.
      replay(tickSfx)
    },
    [tickSfx],
  )

  const stop = useCallback(() => {
    setPhase("idle")
    setRound(1)
    setRemaining(0)
    setPaused(false)
    replay(blipSfx)
  }, [blipSfx])

  const togglePause = useCallback(() => {
    setPaused((p) => !p)
    replay(blipSfx)
  }, [blipSfx])

  const skipRest = useCallback(() => {
    if (phaseRef.current !== "rest") return
    setRemaining(0)
    advance()
  }, [advance])

  const value = useMemo<DrillContextValue>(
    () => ({
      config,
      phase,
      round,
      remaining,
      paused,
      setConfig,
      start,
      stop,
      togglePause,
      skipRest,
    }),
    [
      config,
      phase,
      round,
      remaining,
      paused,
      setConfig,
      start,
      stop,
      togglePause,
      skipRest,
    ],
  )

  return (
    <DrillContext.Provider value={value}>{children}</DrillContext.Provider>
  )
}
