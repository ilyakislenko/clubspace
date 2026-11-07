// Pure playback math shared by the player overlay, its gestures and the speed
// picker. Kept free of React / the player so the edge cases are unit-tested.

// The speed list (both platforms, Plyr's settings menu included).
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

// Double-tap on the left/right third of the picture seeks by this much.
export const DOUBLE_TAP_SEEK_SEC = 10
// Max gap between the taps of a double tap (and of a run of seek taps).
export const DOUBLE_TAP_MS = 300

// Used when the player can't tell the stream's frame rate.
export const FALLBACK_FPS = 30

// A seek target inside the media: never negative, never past the end (when
// the duration is known). Non-finite input lands on 0.
export const clampSeek = (
  seconds: number,
  duration?: number | null,
): number => {
  const lower = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return duration != null && duration > 0 ? Math.min(lower, duration) : lower
}

// One frame back/forward. The target is the *middle* of the neighbouring
// frame: an exact seek shows the frame whose timestamp is <= the target, so a
// mid-frame target survives float/millisecond rounding, and stepping again
// from it (currentTime then reads back that mid-frame time) moves exactly one
// frame each press.
export const frameStepTarget = (
  current: number,
  direction: 1 | -1,
  fps: number | null | undefined,
  duration?: number | null,
): number => {
  const rate = fps != null && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS
  const frame = Math.floor(Math.max(0, current) * rate + 1e-6)
  const target = (Math.max(0, frame + direction) + 0.5) / rate
  return clampSeek(target, duration)
}

// Position for a touch at `x` on a seek track `width` px wide.
export const positionOnTrack = (
  x: number,
  width: number,
  duration: number | null | undefined,
): number => {
  if (width <= 0 || duration == null || duration <= 0) return 0
  return clampSeek((x / width) * duration, duration)
}

export type TapZone = "left" | "center" | "right"

// Which third of the picture a tap at `x` landed in.
export const tapZone = (x: number, width: number): TapZone => {
  if (width <= 0) return "center"
  if (x < width / 3) return "left"
  if (x > (width * 2) / 3) return "right"
  return "center"
}

// `streak` is the signed total seeked by the current run of side taps
// (0 = no run in progress).
export type TapState = { at: number; zone: TapZone | null; streak: number }

export const INITIAL_TAP_STATE: TapState = {
  at: Number.NEGATIVE_INFINITY,
  zone: null,
  streak: 0,
}

export type TapDecision =
  // Toggle the controls right away (a center tap — it can't be a double tap).
  | { kind: "single" }
  // A first side tap: a single tap unless another one follows within
  // DOUBLE_TAP_MS (the caller arms a timer and drops it on the next tap).
  | { kind: "pending" }
  // Second (or later) quick tap on the same side: seek by `delta`; `total` is
  // the run so far, for the «−20 с» label.
  | { kind: "seek"; delta: number; total: number }

// YouTube-style tap classification: two quick taps on the same side third
// seek ±10 s, and every further quick tap on that side adds another ±10 s.
export const registerTap = (
  state: TapState,
  zone: TapZone,
  now: number,
): { state: TapState; decision: TapDecision } => {
  if (zone === "center") {
    return { state: INITIAL_TAP_STATE, decision: { kind: "single" } }
  }
  const quick = now - state.at <= DOUBLE_TAP_MS
  if (quick && zone === state.zone) {
    const delta = zone === "left" ? -DOUBLE_TAP_SEEK_SEC : DOUBLE_TAP_SEEK_SEC
    const total = state.streak + delta
    return {
      state: { at: now, zone, streak: total },
      decision: { kind: "seek", delta, total },
    }
  }
  return { state: { at: now, zone, streak: 0 }, decision: { kind: "pending" } }
}
