import { useEffect, useRef, useState } from "react"
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native"

import { haptics } from "../../shared/haptics"
import type { PlayerHandle } from "./player-types"

// As on YouTube: a finger held on the picture plays at 2x until it lifts.
const BOOST_RATE = 2
const HOLD_MS = 450
// A finger that drifts further than this (px) is swiping, not holding.
const MOVE_TOLERANCE = 12
// The native control bar (seek bar, time, fullscreen) runs along the bottom
// edge; holding there is scrubbing, never a boost.
const CONTROLS_EDGE = 72

// Spread `holdProps` on the View wrapping the player surface. They are raw
// touch props: they observe touches without becoming the responder, so the
// native player still gets every tap (controls, play/pause, seek) as before.
// The speed is set on the player directly and restored to `baseRate` on
// release, so the chosen speed (and its saved preference) never changes.
export function useHoldToBoost(player: PlayerHandle, baseRate: number) {
  const [boosted, setBoosted] = useState(false)
  const boostedRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const height = useRef(0)
  const baseRateRef = useRef(baseRate)
  baseRateRef.current = baseRate

  useEffect(() => () => clearTimeout(timer.current), [])

  const release = () => {
    clearTimeout(timer.current)
    start.current = null
    if (!boostedRef.current) return
    boostedRef.current = false
    setBoosted(false)
    player.playbackRate = baseRateRef.current
  }

  const onTouchStart = (e: GestureResponderEvent) => {
    const { touches, locationY, pageX, pageY } = e.nativeEvent
    // A second finger (pinch) or a press on the control bar is not a hold.
    if (touches.length > 1) return release()
    if (height.current > 0 && locationY > height.current - CONTROLS_EDGE) return
    start.current = { x: pageX, y: pageY }
    timer.current = setTimeout(() => {
      boostedRef.current = true
      setBoosted(true)
      player.playbackRate = BOOST_RATE
      haptics.light()
    }, HOLD_MS)
  }

  const onTouchMove = (e: GestureResponderEvent) => {
    const origin = start.current
    // Once boosted the finger may wander; only an unconfirmed hold is cancelled.
    if (!origin || boostedRef.current) return
    const { pageX, pageY } = e.nativeEvent
    if (Math.hypot(pageX - origin.x, pageY - origin.y) > MOVE_TOLERANCE) release()
  }

  return {
    boosted,
    holdProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: release,
      onTouchCancel: release,
      onLayout: (e: LayoutChangeEvent) => {
        height.current = e.nativeEvent.layout.height
      },
    },
  }
}
