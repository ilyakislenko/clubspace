"use client"

import { useEffect, useMemo, useRef } from "react"

/**
 * Runs `fn` at most once per `intervalMs`: the first call goes through at once,
 * calls inside the interval collapse into one trailing run at its end.
 */
export const createThrottle = (fn: () => void, intervalMs: number) => {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null

  const call = () => {
    const wait = last + intervalMs - Date.now()
    if (wait <= 0) {
      last = Date.now()
      fn()
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      last = Date.now()
      fn()
    }, wait)
  }
  call.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return call
}

/** `createThrottle` for a component: reads the latest `fn`, cancels on unmount. */
export const useThrottledCallback = (fn: () => void, intervalMs: number) => {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const throttled = useMemo(
    () => createThrottle(() => fnRef.current(), intervalMs),
    [intervalMs],
  )
  useEffect(() => throttled.cancel, [throttled])
  return throttled
}
