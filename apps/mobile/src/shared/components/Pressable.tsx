import React, { forwardRef } from "react"
import {
  Pressable as RNPressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native"

import { isWeb } from "../platform"
import { webHitSlopStyle } from "./hit-slop"

/**
 * The app's Pressable. Import this instead of `react-native`'s — an eslint rule
 * enforces it (see eslint.config.mjs).
 *
 * On native it is React Native's Pressable, unchanged. On web, react-native-web
 * renders a Pressable as a plain `<div tabindex="-1">` unless it's told what the
 * element *is*: no keyboard focus, no Enter/Space, nothing for a screen reader.
 * 82 of this app's 114 pressables were in that state — the browser build's
 * interactive surface was almost entirely mouse-only. Declaring the role makes
 * RNW emit a real `<button tabindex="0">`, which browsers then handle for free.
 *
 * So: anything with an `onPress` is a button by default. Pass an explicit
 * `accessibilityRole` to say otherwise — `"none"` for the structural pressables
 * that only exist to catch a tap (a modal backdrop, a sheet that swallows
 * presses so they don't reach the backdrop). Those must stay non-buttons: HTML
 * forbids nesting interactive content, and a `<button>` wrapping the real
 * buttons inside a sheet makes the browser restructure the DOM.
 */
export type AppPressableProps = PressableProps

// react-native-web widens the pressable state with pointer/keyboard flags that
// React Native's own types don't carry, since they can't happen on a phone.
type WebPressableState = {
  pressed: boolean
  hovered?: boolean
  focused?: boolean
}

// Desktop needs to see that a row reacts before it's clicked. RNW already gives
// pressables `cursor: pointer`; this adds the feedback that goes with it.
const HOVER_OPACITY = 0.86

export const Pressable = forwardRef<View, AppPressableProps>(
  function AppPressable({ accessibilityRole, style, ...rest }, ref) {
    const role =
      accessibilityRole ?? (rest.onPress || rest.onLongPress ? "button" : undefined)

    // Native keeps the caller's style exactly as written — no wrapper, no extra
    // work per press.
    if (!isWeb) {
      return (
        <RNPressable
          ref={ref}
          accessibilityRole={role}
          style={style}
          {...rest}
        />
      )
    }

    const webStyle = (state: WebPressableState): StyleProp<ViewStyle> => {
      const base = typeof style === "function" ? style(state) : style
      // RNW ignores hitSlop, so small controls end up as small as their glyph.
      const slop = webHitSlopStyle(
        rest.hitSlop,
        StyleSheet.flatten(base) as ViewStyle | undefined,
      )
      // A disabled control shouldn't look like it's responding to the pointer —
      // nor should a structural one (role "none": a modal's backdrop and sheet),
      // which otherwise dimmed the whole dialog while the mouse was over it.
      const hover =
        state.hovered && !rest.disabled && role !== "none"
          ? { opacity: HOVER_OPACITY }
          : null
      if (!slop && !hover) return base
      return [base, slop, hover]
    }

    return (
      <RNPressable
        ref={ref}
        accessibilityRole={role}
        style={webStyle}
        {...rest}
      />
    )
  },
)
