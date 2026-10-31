import { useCallback, useRef, useState, type ReactNode } from "react"
import {
  KeyboardAvoidingView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

// Keeps a screen's content above the on-screen keyboard. Use this instead of
// a bare KeyboardAvoidingView.
//
// KeyboardAvoidingView compares its *parent-relative* frame with the
// keyboard's *screen* position, so it must be told where it sits on the
// screen (`keyboardVerticalOffset`). Screens passed `useHeaderHeight()` for
// that, which only holds when the native header is the only thing above the
// view: on an Android 16 tablet in landscape it reported 240 dp for a 96 dp
// header (status bar included), so the content was squeezed far above the
// keyboard — an empty band in between, the focused field cut off and its
// button gone. Measuring the
// view's own position on screen is right on every screen, platform and
// orientation.
//
// "padding" on both platforms: with edge-to-edge (the Expo config's
// edgeToEdgeEnabled, enforced from Android 15) the OS no longer resizes the
// window for the keyboard.
export function KeyboardAvoidingContainer({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const ref = useRef<View>(null)
  const [pageY, setPageY] = useState(0)

  // pageY, not measureInWindow: the keyboard's screenY counts from the top of
  // the screen, and on edge-to-edge Android measureInWindow leaves out the
  // status bar (64 vs 96 dp on the tablet) — the viewport then reached that
  // far under the keyboard.
  const measure = useCallback(() => {
    ref.current?.measure((_x, _y, _width, _height, _pageX, y) => {
      if (Number.isFinite(y)) setPageY(y)
    })
  }, [])

  return (
    <View
      ref={ref}
      // The caller's style alone when given: a fixed-width side panel
      // (`flexGrow: 0`) must not inherit flex:1's zero flex-basis.
      style={style ?? styles.flex}
      onLayout={measure}
      collapsable={false}
    >
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={pageY}
        style={styles.flex}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
})
