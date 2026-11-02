"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"

import {
  clamp,
  PX_PER_MINUTE,
  SNAP_MINUTES,
  snapMinutes,
  type HourRange,
} from "./calendar-helpers"
import type { ClassItem } from "./calendar-items"

export type DragTarget = { date: string; startMin: number; endMin: number }

export type DragState = {
  item: ClassItem
  mode: "move" | "resize"
  target: DragTarget
}

// Below this many pixels a press is a click, not a drag.
const DRAG_THRESHOLD_PX = 4
// Pointer this close to the scroll box edge scrolls the grid.
const EDGE_PX = 48
const EDGE_SPEED_PX = 14

type Pending = {
  item: ClassItem
  mode: "move" | "resize"
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  // Minutes between the pointer and the class start at grab time.
  grabOffsetMin: number
  started: boolean
  // Escape pressed: no preview, no drop; the press still ends at pointerup.
  cancelled: boolean
}

/**
 * Pointer-driven drag & resize over the time grid (volt used react-dnd; the
 * admin has no DnD library, and pointer events give the 15-minute snapping and
 * a live preview without the HTML5 drag image). `gridRef` is the element whose
 * top edge is the first visible hour line; `columnDates` is the day of each of
 * its columns, which are equally wide — except in the day view «По залам»,
 * where every hall column is the same day, so a drag there changes only the time.
 */
export function useGridDrag(opts: {
  columnDates: readonly string[]
  range: HourRange
  gridRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  onDrop: (item: ClassItem, target: DragTarget) => void
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const pending = useRef<Pending | null>(null)
  const suppressClick = useRef(false)
  const frame = useRef<number | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const targetAt = useCallback((p: Pending): DragTarget | null => {
    const { columnDates, range, gridRef } = optsRef.current
    const grid = gridRef.current
    if (!grid) return null
    const rect = grid.getBoundingClientRect()
    const col = clamp(
      Math.floor(((p.lastX - rect.left) / rect.width) * columnDates.length),
      0,
      columnDates.length - 1,
    )
    const minute = (p.lastY - rect.top) / PX_PER_MINUTE + range.from * 60
    const lo = range.from * 60
    const hi = Math.min(range.to * 60, 24 * 60)
    const duration = p.item.endMin - p.item.startMin
    if (p.mode === "move") {
      const start = clamp(snapMinutes(minute - p.grabOffsetMin), lo, hi - duration)
      return { date: columnDates[col], startMin: start, endMin: start + duration }
    }
    const end = clamp(
      snapMinutes(minute),
      p.item.startMin + SNAP_MINUTES,
      hi,
    )
    return { date: p.item.date, startMin: p.item.startMin, endMin: end }
  }, [])

  const refresh = useCallback(() => {
    const p = pending.current
    if (!p?.started || p.cancelled) return
    const target = targetAt(p)
    if (!target) return
    setDrag((prev) =>
      prev &&
      prev.target.date === target.date &&
      prev.target.startMin === target.startMin &&
      prev.target.endMin === target.endMin
        ? prev
        : { item: p.item, mode: p.mode, target },
    )
  }, [targetAt])

  const stop = useCallback(() => {
    pending.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setDrag(null)
  }, [])

  // Scroll while the pointer rests near the top / bottom edge.
  const autoScroll = useCallback(() => {
    const p = pending.current
    const box = optsRef.current.scrollRef.current
    if (!p?.started || p.cancelled || !box) {
      frame.current = null
      return
    }
    const rect = box.getBoundingClientRect()
    let delta = 0
    if (p.lastY < rect.top + EDGE_PX) delta = -EDGE_SPEED_PX
    else if (p.lastY > rect.bottom - EDGE_PX) delta = EDGE_SPEED_PX
    if (delta !== 0) {
      box.scrollTop += delta
      refresh()
    }
    frame.current = requestAnimationFrame(autoScroll)
  }, [refresh])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pending.current
      if (!p || p.cancelled || e.pointerId !== p.pointerId) return
      p.lastX = e.clientX
      p.lastY = e.clientY
      if (!p.started) {
        if (
          Math.abs(e.clientX - p.startX) < DRAG_THRESHOLD_PX &&
          Math.abs(e.clientY - p.startY) < DRAG_THRESHOLD_PX
        ) {
          return
        }
        p.started = true
        if (frame.current === null) frame.current = requestAnimationFrame(autoScroll)
      }
      e.preventDefault()
      refresh()
    }
    const onUp = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.pointerId) return
      if (p.started) {
        // The click that follows this pointerup (if it lands on the block)
        // must not open the details panel; nothing later may be swallowed.
        suppressClick.current = true
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
        const target = targetAt(p)
        const { item, cancelled } = p
        stop()
        if (
          !cancelled &&
          target &&
          (target.date !== item.date ||
            target.startMin !== item.startMin ||
            target.endMin !== item.endMin)
        ) {
          optsRef.current.onDrop(item, target)
        }
        return
      }
      pending.current = null
    }
    // Escape drops the preview; the press itself ends at pointerup.
    const onKey = (e: KeyboardEvent) => {
      const p = pending.current
      if (e.key !== "Escape" || !p) return
      p.cancelled = true
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      setDrag(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("keydown", onKey)
    }
  }, [autoScroll, refresh, stop, targetAt])

  const begin = useCallback(
    (e: ReactPointerEvent<HTMLElement>, item: ClassItem, mode: "move" | "resize") => {
      if (e.button !== 0 || !item.editable) return
      const grid = optsRef.current.gridRef.current
      if (!grid) return
      const rect = grid.getBoundingClientRect()
      const minute =
        (e.clientY - rect.top) / PX_PER_MINUTE + optsRef.current.range.from * 60
      pending.current = {
        item,
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        grabOffsetMin: minute - item.startMin,
        started: false,
        cancelled: false,
      }
    },
    [],
  )

  // True once for the click right after a drag.
  const consumeClick = useCallback(() => {
    const s = suppressClick.current
    suppressClick.current = false
    return s
  }, [])

  return { drag, begin, consumeClick }
}
