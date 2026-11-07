import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { Theme } from "../theme"
import { useTheme, useThemedStyles } from "../theme-context"
import { useResponsive } from "../useResponsive"
import { Chevron } from "./Chevron"
import { CountBadge } from "./CountBadge"
import { Pressable } from "./Pressable"

/**
 * A titled sheet: a bottom sheet on phones, a centered card on larger windows
 * (the shell of `ClubSwitcherSheet` / `OccurrenceSheet`). A tap outside or the
 * back gesture closes it; the body scrolls when it outgrows the window.
 *
 * `visible={false}` fades it out; `onDismiss` fires once it's gone. iOS can't
 * present a modal, alert or share sheet while this one is still dismissing,
 * so a choice that opens one waits for `onDismiss` — see `useSheetAction`.
 * (Android and web drop the modal at once: there `onDismiss` fires right
 * after `visible` turns false.)
 */
export function Sheet({
  title,
  visible = true,
  onClose,
  onDismiss,
  children,
}: {
  title: string
  visible?: boolean
  onClose: () => void
  onDismiss?: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { sizeClass, height } = useResponsive()
  const compact = sizeClass === "compact"

  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })
  useEffect(() => {
    if (!visible && Platform.OS !== "ios") onDismissRef.current?.()
  }, [visible])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? onDismiss : undefined}
      statusBarTranslucent
    >
      <Pressable
        style={[
          styles.backdrop,
          compact ? styles.backdropBottom : styles.backdropCenter,
        ]}
        onPress={onClose}
        // VoiceOver's two-finger scrub closes the sheet, like a tap outside.
        onAccessibilityEscape={onClose}
        // Structural, not a control: it only catches taps outside the sheet.
        accessibilityRole="none"
      >
        <Pressable
          style={[
            styles.sheet,
            compact ? styles.sheetBottom : styles.sheetCenter,
            {
              maxHeight: height * 0.85,
              // Android draws edge-to-edge: keep the last row above the
              // system navigation bar.
              paddingBottom: theme.spacing(4) + (compact ? insets.bottom : 0),
            },
          ]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap inside the sheet doesn't dismiss it */
          }}
        >
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/**
 * Open/close state of a `Sheet` whose choices may open something else (a
 * modal, an alert, the share sheet, a screen): `run(action)` closes the sheet
 * and runs `action` only once it's dismissed. `apply(action)` runs it now and
 * closes — for in-place choices that open nothing (a setting, a mark at the
 * current moment). Spread `sheetProps` on the `Sheet`; render it while
 * `mounted` (it stays mounted while fading out).
 *
 * A sheet component the caller mounts and unmounts itself passes
 * `initiallyOpen` and gets `onClosed` once it's gone, after which the caller
 * unmounts it.
 */
export function useSheetAction({
  initiallyOpen = false,
  onClosed,
}: { initiallyOpen?: boolean; onClosed?: () => void } = {}) {
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(
    initiallyOpen ? "open" : "closed",
  )
  // Set from the close until the next open: a second tap on a row while the
  // sheet fades out (iOS) is ignored, not run twice.
  const closing = useRef(false)
  const pending = useRef<(() => void) | null>(null)
  const onClosedRef = useRef(onClosed)
  useEffect(() => {
    onClosedRef.current = onClosed
  })

  const open = useCallback(() => {
    closing.current = false
    pending.current = null
    setPhase("open")
  }, [])
  const close = useCallback(() => {
    closing.current = true
    setPhase((p) => (p === "open" ? "closing" : p))
  }, [])
  const run = useCallback(
    (action: () => void) => {
      if (closing.current) return
      pending.current = action
      close()
    },
    [close],
  )
  const apply = useCallback(
    (action: () => void) => {
      if (closing.current) return
      action()
      close()
    },
    [close],
  )
  const onDismiss = useCallback(() => {
    setPhase((p) => (p === "closing" ? "closed" : p))
    const action = pending.current
    pending.current = null
    onClosedRef.current?.()
    action?.()
  }, [])

  return {
    mounted: phase !== "closed",
    open,
    close,
    run,
    apply,
    sheetProps: { visible: phase === "open", onClose: close, onDismiss },
  }
}

/** One destination in a sheet menu: label, optional count, chevron. */
export function SheetRow({
  label,
  count = 0,
  onPress,
  accessibilityLabel,
}: {
  label: string
  count?: number
  onPress: () => void
  accessibilityLabel?: string
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (count > 0 ? `${label}, ${count}` : label)
      }
      style={styles.row}
    >
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.rowEnd}>
        <CountBadge count={count} />
        <Chevron style={styles.chev} />
      </View>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.colors.overlay },
    backdropBottom: { justifyContent: "flex-end" },
    backdropCenter: {
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      backgroundColor: theme.colors.surfaceElevated,
      paddingTop: theme.spacing(5),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    sheetBottom: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    sheetCenter: { maxWidth: 460, borderRadius: theme.radius.lg },
    title: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.text,
      paddingHorizontal: theme.spacing(5),
    },
    scroll: { flexGrow: 0 },
    content: {
      paddingHorizontal: theme.spacing(5),
      paddingBottom: theme.spacing(1),
      gap: theme.spacing(3),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      minHeight: 48,
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLabel: {
      flex: 1,
      ...theme.typography.body,
      color: theme.colors.text,
    },
    rowEnd: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    chev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
  })
