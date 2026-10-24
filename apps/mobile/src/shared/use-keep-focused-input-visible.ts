import { useIsFocused } from "@react-navigation/native"
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react"
import {
  Keyboard,
  Platform,
  // Only TextInput.State (which field has focus) — nothing is rendered here.
  // eslint-disable-next-line no-restricted-imports
  TextInput,
  type HostInstance,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native"

import { revealScrollOffset } from "./keyboard-reveal"

// ScrollView has getInnerViewRef at runtime (RN 0.81), but its TypeScript
// declaration only lists the deprecated numeric getInnerViewNode.
type ScrollViewWithInnerRef = ScrollView & {
  getInnerViewRef(): HostInstance | null
}

// Once the keyboard is open, scrolls `scrollRef` so the focused field sits
// above it. Pair with KeyboardAvoidingContainer around the scroll view, and
// spread the returned props onto the ScrollView:
//
//   const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
//   <ScrollView ref={scrollRef} {...keyboardScroll}>
//
// Android scrolls a focused field into view at focus time — before the
// container shrinks the viewport for the keyboard — so a field that was
// visible then ends up under the keyboard (a new bookmark's name in the video
// side panel on a landscape tablet). iOS doesn't scroll to it at all.
//
// Works in content coordinates (measureLayout against the scroll content),
// which don't depend on a scroll that is still animating. A field outside this
// scroll view fails to measure and is left alone, and the listener is only
// active while the screen is focused — tab screens stay mounted.
export function useKeepFocusedInputVisible(
  scrollRef: RefObject<ScrollView | null>,
) {
  const offset = useRef(0)
  const viewportHeight = useRef(0)
  const isFocused = useIsFocused()

  useEffect(() => {
    if (!isFocused || Platform.OS === "web") return
    const event = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    let timers: ReturnType<typeof setTimeout>[] = []
    const reveal = (animated: boolean) => {
      const scroll = scrollRef.current
      const content = (scroll as ScrollViewWithInnerRef | null)?.getInnerViewRef()
      const field = TextInput.State.currentlyFocusedInput()
      if (!scroll || !content || !field) return
      field.measureLayout(
        content,
        (_x, y, _width, height) => {
          const target = revealScrollOffset(
            y + height,
            viewportHeight.current,
            offset.current,
          )
          if (target !== null) scroll.scrollTo({ y: target, animated })
        },
        () => undefined,
      )
    }
    const sub = Keyboard.addListener(event, () => {
      timers.forEach(clearTimeout)
      // Once the container has applied its keyboard padding (the viewport
      // height comes from onLayout), then again once everything has settled.
      timers = [
        setTimeout(() => reveal(true), 150),
        setTimeout(() => reveal(false), 450),
      ]
    })
    return () => {
      timers.forEach(clearTimeout)
      sub.remove()
    }
  }, [isFocused, scrollRef])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y
    },
    [],
  )
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportHeight.current = e.nativeEvent.layout.height
  }, [])

  return useMemo(
    () => ({ onScroll, onLayout, scrollEventThrottle: 16 }),
    [onScroll, onLayout],
  )
}
