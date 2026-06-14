import React, {
  createContext,
  useCallback,
  useContext,
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

import { theme } from "../theme"

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
  const [toast, setToast] = useState<ToastContent | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(16)).current
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insets = useSafeAreaInsets()

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
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

const styles = StyleSheet.create({
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
    color: theme.colors.accentText,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
})
