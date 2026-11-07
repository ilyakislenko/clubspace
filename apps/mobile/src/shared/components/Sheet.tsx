import React, { type ReactNode } from "react"
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native"
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
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { sizeClass, height } = useResponsive()
  const compact = sizeClass === "compact"

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
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
