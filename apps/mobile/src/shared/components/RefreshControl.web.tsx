/// <reference lib="dom" />
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useTheme } from "../theme-context"
import {
  MAX_PULL,
  isPullGesture,
  pullDistance,
  shouldRefresh,
} from "./pull-to-refresh"

/**
 * Pull-to-refresh for the web build.
 *
 * react-native-web's RefreshControl destructures `onRefresh`, `refreshing` and
 * friends out of its props and renders `<View {...rest} />` — every one of them
 * is dropped. So on the PWA the gesture did nothing on 14 list screens, and
 * there was no other way to refresh a list short of reloading the page.
 *
 * RNW's ScrollView does render this element though: it clones it with the
 * scroll view as its child. That's the hook — this component wraps the list,
 * watches touches on the wrapper, and drives `onRefresh` itself.
 *
 * Touch only, deliberately. A mouse has no pull gesture, and desktop users have
 * a reload button that now restores the screen they were on (the app has real
 * URLs) and repaints instantly from the cache.
 */
export function RefreshControl({
  refreshing,
  onRefresh,
  children,
  style,
}: RefreshControlProps & {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const containerRef = useRef<View>(null)
  const [pull, setPull] = useState(0)
  // Mirrored in a ref so touchend can read the distance without inspecting it
  // from inside a state updater — React runs those during render, and calling
  // the screen's onRefresh from there is a setState-in-render warning.
  const pullRef = useRef(0)
  const setPullDistance = useCallback((next: number) => {
    pullRef.current = next
    setPull(next)
  }, [])

  // Sampled on touchstart: see isPullGesture for why it isn't re-checked.
  const gesture = useRef<{ startY: number; atTop: boolean } | null>(null)

  const findScroller = useCallback((root: HTMLElement): HTMLElement | null => {
    // The RN tsconfig targets es2022 without downlevelIteration, so a NodeList
    // isn't iterable here — index it.
    const nodes = root.querySelectorAll<HTMLElement>("*")
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      const overflow = getComputedStyle(node).overflowY
      if (
        (overflow === "auto" || overflow === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        return node
      }
    }
    return null
  }, [])

  useEffect(() => {
    const node = containerRef.current as unknown as HTMLElement | null
    if (!node || !onRefresh) return

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const scroller = findScroller(node)
      gesture.current = {
        startY: event.touches[0].clientY,
        // No scroller yet (a short list that doesn't overflow) still counts as
        // "at the top" — those screens need refreshing just as much.
        atTop: !scroller || scroller.scrollTop <= 0,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = gesture.current
      if (!start || refreshing) return
      const y = event.touches[0].clientY
      if (!isPullGesture(start.atTop, start.startY, y)) {
        setPullDistance(0)
        return
      }
      setPullDistance(pullDistance(y - start.startY))
    }

    const onTouchEnd = () => {
      const start = gesture.current
      gesture.current = null
      const distance = pullRef.current
      setPullDistance(0)
      if (start && !refreshing && shouldRefresh(distance)) onRefresh()
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true })
    node.addEventListener("touchmove", onTouchMove, { passive: true })
    node.addEventListener("touchend", onTouchEnd, { passive: true })
    node.addEventListener("touchcancel", onTouchEnd, { passive: true })
    return () => {
      node.removeEventListener("touchstart", onTouchStart)
      node.removeEventListener("touchmove", onTouchMove)
      node.removeEventListener("touchend", onTouchEnd)
      node.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [findScroller, onRefresh, refreshing, setPullDistance])

  // While refreshing, hold the indicator open at the trigger point so the
  // spinner has somewhere to sit.
  const offset = refreshing ? MAX_PULL * 0.6 : pull
  const visible = offset > 0

  return (
    <View ref={containerRef} style={[styles.container, style]}>
      {visible && (
        <View
          style={[styles.indicator, { height: offset }]}
          // The list itself is the accessible content; this is decoration.
          aria-hidden
        >
          <ActivityIndicator
            color={theme.colors.accent}
            // Only spin once it's actually doing something.
            animating={refreshing || offset >= MAX_PULL * 0.6}
          />
        </View>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  content: { flex: 1, minHeight: 0 },
  indicator: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
})
