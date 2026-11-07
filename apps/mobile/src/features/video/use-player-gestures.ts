import { useEffect, useRef, useState } from "react"
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native"

import { haptics } from "../../shared/haptics"
import {
  DOUBLE_TAP_MS,
  INITIAL_TAP_STATE,
  registerTap,
  tapZone,
  type TapState,
} from "./player-math"
import type { PlayerHandle } from "./player-types"

// As on YouTube: a finger held on the picture plays at 2x until it lifts.
const BOOST_RATE = 2
const HOLD_MS = 450
// A finger that drifts further than this (px) is swiping, not holding/tapping.
const MOVE_TOLERANCE = 12
// Web: Plyr's control bar (seek bar, time, fullscreen) runs along the bottom
// edge; holding there is scrubbing, never a boost. Natively the overlay's own
// seek bar sits above the gesture layer and takes those touches itself.
const CONTROLS_EDGE = 72
// How long the «+10 с» ripple stays after the last seek tap.
const SEEK_FEEDBACK_MS = 700

export type SeekFeedback = {
  side: "left" | "right"
  // Signed seconds seeked by the current run of taps.
  total: number
  // Changes on every seek tap, so the ripple restarts.
  key: number
}

type Options = {
  player: PlayerHandle
  // Tap handling (native overlay only — on web Plyr owns taps and only the
  // hold is observed). A single tap; fired after DOUBLE_TAP_MS on the side
  // thirds, where it might still become a double tap.
  onTap?: () => void
  // A double tap on a side third: seek by ±DOUBLE_TAP_SEEK_SEC.
  onSeekBy?: (seconds: number) => void
}

// Touch handling for the picture: hold → 2x, tap → onTap, double tap on the
// left/right third → onSeekBy(∓10). The speed boost is set on the player
// directly and the speed it had when the hold began comes back on release —
// whoever set it (our speed sheet or Plyr's own menu on web), and its saved
// preference never changes.
export function usePlayerGestures({ player, onTap, onSeekBy }: Options) {
  const [boosted, setBoosted] = useState(false)
  const [seekFeedback, setSeekFeedback] = useState<SeekFeedback | null>(null)
  // The speed to restore on release; null = no boost running.
  const boostedFrom = useRef<number | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  // The touch in progress; `held` = it outlasted HOLD_MS (so it's no tap).
  const touch = useRef<{
    x: number
    pageX: number
    pageY: number
    moved: boolean
    held: boolean
  } | null>(null)
  const size = useRef({ width: 0, height: 0 })
  const tapState = useRef<TapState>(INITIAL_TAP_STATE)
  const latest = useRef({ onTap, onSeekBy })
  latest.current = { onTap, onSeekBy }

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current)
      clearTimeout(tapTimer.current)
      clearTimeout(feedbackTimer.current)
    },
    [],
  )

  // Returns whether a boost was active (that touch was a hold, not a tap).
  const endBoost = (): boolean => {
    const restore = boostedFrom.current
    if (restore === null) return false
    boostedFrom.current = null
    setBoosted(false)
    player.playbackRate = restore
    return true
  }

  const cancel = () => {
    clearTimeout(holdTimer.current)
    touch.current = null
    endBoost()
  }

  const begin = (e: GestureResponderEvent, skipBottomEdge: boolean) => {
    const { touches, locationX, locationY, pageX, pageY } = e.nativeEvent
    // A second finger (pinch) is neither a hold nor a tap.
    if (touches.length > 1) return cancel()
    const { height } = size.current
    if (skipBottomEdge && height > 0 && locationY > height - CONTROLS_EDGE) {
      return
    }
    touch.current = { x: locationX, pageX, pageY, moved: false, held: false }
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      const current = touch.current
      if (!current) return
      current.held = true
      // Boosting a paused video would do nothing visible.
      if (!player.playing) return
      boostedFrom.current = player.playbackRate
      setBoosted(true)
      player.playbackRate = BOOST_RATE
      haptics.light()
    }, HOLD_MS)
  }

  const move = (e: GestureResponderEvent) => {
    const current = touch.current
    // Once boosted the finger may wander; only an unconfirmed hold is cancelled.
    if (!current || current.moved || boostedFrom.current !== null) return
    const { pageX, pageY } = e.nativeEvent
    if (Math.hypot(pageX - current.pageX, pageY - current.pageY) > MOVE_TOLERANCE) {
      current.moved = true
      clearTimeout(holdTimer.current)
    }
  }

  const end = () => {
    clearTimeout(holdTimer.current)
    const current = touch.current
    touch.current = null
    if (endBoost() || !current || current.moved || current.held) return
    const { onTap: tap, onSeekBy: seekBy } = latest.current
    if (!tap) return
    const { state, decision } = registerTap(
      tapState.current,
      tapZone(current.x, size.current.width),
      Date.now(),
    )
    tapState.current = state
    clearTimeout(tapTimer.current)
    if (decision.kind === "single") {
      tap()
    } else if (decision.kind === "pending") {
      tapTimer.current = setTimeout(() => latest.current.onTap?.(), DOUBLE_TAP_MS)
    } else {
      seekBy?.(decision.delta)
      setSeekFeedback({
        side: decision.delta < 0 ? "left" : "right",
        total: decision.total,
        key: Date.now(),
      })
      clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(
        () => setSeekFeedback(null),
        SEEK_FEEDBACK_MS,
      )
    }
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    size.current = { width, height }
  }

  return {
    boosted,
    seekFeedback,
    // Native: spread on the overlay's gesture layer, which claims every touch
    // that reaches it (the controls above it take their own touches first).
    responderProps: {
      onStartShouldSetResponder: () => true,
      onResponderGrant: (e: GestureResponderEvent) => begin(e, false),
      onResponderMove: move,
      onResponderRelease: end,
      onResponderTerminate: cancel,
      onLayout,
    },
    // Web: spread on the View wrapping Plyr. Raw touch props observe touches
    // without becoming the responder, so Plyr still gets every tap.
    passiveHoldProps: {
      onTouchStart: (e: GestureResponderEvent) => begin(e, true),
      onTouchMove: move,
      onTouchEnd: end,
      onTouchCancel: cancel,
      onLayout,
    },
  }
}
