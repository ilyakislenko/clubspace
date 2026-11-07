import React from "react"
import { Modal, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { PLAYBACK_RATES } from "./player-math"

type ListProps = {
  rate: number
  onSelect: (rate: number) => void
}

/**
 * The speed choices as a single-choice list, the current one ticked. Shared
 * by the sheet below and the popover inside the player overlay (which can't
 * open a Modal without un-hiding the status bar in fullscreen).
 */
export function PlaybackRateList({ rate, onSelect }: ListProps) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {PLAYBACK_RATES.map((option) => {
        const selected = option === rate
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option}x`}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
              {option === 1 ? "1x · обычная" : `${option}x`}
            </Text>
            {selected && (
              <Icon name="checkmark" size={18} color={theme.colors.accent} />
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * The speed picker as a sheet (the AbonementPickerSheet pattern): a bottom
 * sheet on phones, a centered card on larger windows.
 */
export function PlaybackSpeedSheet({
  rate,
  onSelect,
  onClose,
}: ListProps & { onClose: () => void }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { sizeClass } = useResponsive()
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
        onAccessibilityEscape={onClose}
        // Structural, not a control: it only catches taps outside the sheet.
        accessibilityRole="none"
      >
        <Pressable
          style={[
            styles.sheet,
            compact ? styles.sheetBottom : styles.sheetCenter,
            { paddingBottom: theme.spacing(5) + (compact ? insets.bottom : 0) },
          ]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap inside the sheet doesn't dismiss it */
          }}
        >
          <Text style={styles.title}>Скорость воспроизведения</Text>
          <PlaybackRateList rate={rate} onSelect={onSelect} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.spacing(1) },
    option: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2) + 2,
      borderRadius: theme.radius.md,
    },
    optionSelected: { backgroundColor: theme.colors.surfaceMuted },
    pressed: { opacity: 0.7 },
    optionText: { fontSize: 15, color: theme.colors.text },
    optionTextSelected: { fontWeight: "700" },
    backdrop: { flex: 1, backgroundColor: theme.colors.overlay },
    backdropBottom: { justifyContent: "flex-end" },
    backdropCenter: {
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      gap: theme.spacing(3),
      backgroundColor: theme.colors.surfaceElevated,
      paddingTop: theme.spacing(5),
      paddingHorizontal: theme.spacing(5),
      ...theme.shadows.sm,
    },
    sheetBottom: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    sheetCenter: { maxWidth: 360, borderRadius: theme.radius.lg },
    title: { fontSize: 20, fontWeight: "700", color: theme.colors.text },
  })
