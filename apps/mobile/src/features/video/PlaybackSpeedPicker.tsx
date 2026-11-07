import React from "react"
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { PLAYBACK_RATES } from "./player-math"

type ListProps = {
  rate: number
  onSelect: (rate: number) => void
}

/**
 * The speed choices as a single-choice list, the current one ticked. Shared
 * by the player overlay's popover and the side panel's anchored popover.
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

type PopoverProps = ListProps & { style?: StyleProp<ViewStyle> }

/**
 * The speed list in a small floating card. The caller positions it: the
 * player overlay places it absolutely above its chip, and
 * {@link AnchoredPlaybackSpeedPopover} anchors it to a chip elsewhere.
 */
export function PlaybackRatePopover({ rate, onSelect, style }: PopoverProps) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.popover, style]}>
      <ScrollView>
        <PlaybackRateList rate={rate} onSelect={onSelect} />
      </ScrollView>
    </View>
  )
}

/** A chip's frame in screen coordinates (`measure` pageX/pageY). */
export type AnchorRect = { x: number; y: number; width: number; height: number }

const POPOVER_WIDTH = 200
/** Natural height of the 7-option list; used only to pick above vs below. */
const POPOVER_NATURAL_HEIGHT = 340

/**
 * The speed popover anchored to a chip outside the player (the lesson side
 * panel): right-aligned to the chip, opening below it when the list fits,
 * otherwise on whichever side has more room, scrolling if it still doesn't
 * fit. Clamped to the window so it stays on screen on tablet and phone.
 * Tapping outside or Android back closes it.
 */
export function AnchoredPlaybackSpeedPopover({
  anchor,
  rate,
  onSelect,
  onClose,
}: ListProps & { anchor: AnchorRect; onClose: () => void }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const margin = theme.spacing(2)
  const gap = theme.spacing(1)

  const left = Math.min(
    Math.max(anchor.x + anchor.width - POPOVER_WIDTH, margin + insets.left),
    window.width - POPOVER_WIDTH - margin - insets.right,
  )
  const below = anchor.y + anchor.height + gap
  const spaceBelow = window.height - below - margin - insets.bottom
  const spaceAbove = anchor.y - gap - margin - insets.top
  const openBelow = spaceBelow >= POPOVER_NATURAL_HEIGHT || spaceBelow >= spaceAbove
  const vertical = openBelow
    ? { top: below }
    : { bottom: window.height - anchor.y + gap }
  const maxHeight = Math.max(openBelow ? spaceBelow : spaceAbove, 0)

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        onAccessibilityEscape={onClose}
        // Structural, not a control: it only catches taps outside the list.
        accessibilityRole="none"
      >
        <Pressable
          style={[styles.anchored, { left }, vertical]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap on the card's padding doesn't dismiss it */
          }}
        >
          <PlaybackRatePopover
            rate={rate}
            onSelect={onSelect}
            style={{ maxHeight }}
          />
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
    backdrop: { flex: 1 },
    popover: {
      width: POPOVER_WIDTH,
      padding: theme.spacing(2),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      ...theme.shadows.sm,
    },
    anchored: { position: "absolute" },
  })
