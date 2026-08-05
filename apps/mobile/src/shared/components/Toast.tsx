import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { Theme } from "../theme"
import { useTheme, useThemedStyles } from "../theme-context"

export type ToastVariant = "default" | "success" | "error"

type ToastContent = { message: string; variant: ToastVariant }

const ToastContext = createContext<{
  showToast: (message: string, variant?: ToastVariant) => void
}>({ showToast: () => undefined })

/**
 * Lightweight, dependency-free snackbar. One toast at a time (a new one
 * replaces the current); auto-dismisses; sits above the safe area. Every
 * toast is also announced to screen readers, so the same call doubles as the
 * accessible confirmation for an action.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [toast, setToast] = useState<ToastContent | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(16)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insets = useSafeAreaInsets()

  // Stop the pending dismiss timer + any in-flight animation on unmount so the
  // delayed setToast(null) can't fire on a torn-down tree.
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      opacity.stopAnimation()
      translateY.stopAnimation()
    },
    [opacity, translateY],
  )

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "default") => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setToast({ message, variant })
      AccessibilityInfo.announceForAccessibility(message)
      opacity.setValue(0)
      translateY.setValue(16)
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 80,
          useNativeDriver: true,
        }),
      ]).start()
      hideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 16,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => setToast(null))
      }, 2200)
    },
    [opacity, translateY],
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { bottom: insets.bottom + theme.spacing(6), opacity },
            { transform: [{ translateY }] },
          ]}
        >
          <View
            style={[
              styles.toast,
              toast.variant === "success" && styles.success,
              toast.variant === "error" && styles.error,
            ]}
          >
            <Text
              style={[
                styles.text,
                toast.variant !== "default" && styles.textOnFill,
              ]}
            >
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

// Themed at runtime: the toast is the app's confirmation channel on every
// screen, and building it from the static default theme left it light-on-light
// (and with the wrong corner radius / shadow language) on the other themes.
const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      left: theme.spacing(4),
      right: theme.spacing(4),
      alignItems: "center",
    },
    toast: {
      maxWidth: 480,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.text,
      ...theme.shadows.lg,
    },
    success: { backgroundColor: theme.colors.success },
    error: { backgroundColor: theme.colors.danger },
    text: {
      // The neutral toast is painted in `colors.text`, so the thing that
      // contrasts with it is the *screen* background colour — not a fixed white,
      // which vanished on the dark themes where `colors.text` is near-white.
      color: theme.colors.background,
      fontSize: 14,
      fontWeight: "600",
      textAlign: "center",
    },
    // The success/error fills are saturated in every theme and always want
    // light type on top.
    textOnFill: { color: theme.colors.accentText },
  })
