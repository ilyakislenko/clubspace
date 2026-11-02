import React from "react"
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { VisitAbonement } from "../../shared/api/attendance"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { DirectionTag } from "../directions/DirectionTag"
import { abonementDetail } from "./roster-helpers"

/**
 * The abonements a visit can be spent on, default first, as a single-choice
 * list: name, what is left, and the scope — direction chips for a scoped one,
 * «Весь клуб» for a club-wide one only when the club has directions (that is
 * when the contrast means something).
 */
export function AbonementOptionList({
  options,
  selectedId,
  onSelect,
  clubHasDirections,
  disabled = false,
}: {
  options: readonly VisitAbonement[]
  selectedId: string | null
  onSelect: (subscriptionId: string) => void
  clubHasDirections: boolean
  disabled?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.subscriptionId === selectedId
        const detail = abonementDetail(o)
        return (
          <Pressable
            key={o.subscriptionId}
            onPress={() => onSelect(o.subscriptionId)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected && <View style={styles.radioDot} />}
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.planName}>{o.planName}</Text>
              {detail && <Text style={styles.detail}>{detail}</Text>}
              {o.directions.length > 0 ? (
                <View style={styles.chips}>
                  {o.directions.map((d) => (
                    <DirectionTag key={d.id} direction={d} chip />
                  ))}
                </View>
              ) : clubHasDirections ? (
                <View style={styles.chips}>
                  <Text style={styles.clubWide}>Весь клуб</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * The coach's abonement picker for one roster row: a bottom sheet on phones,
 * a centered card on larger windows (the OccurrenceSheet pattern). Picking a
 * row reports it; the caller decides whether that is a local choice or a
 * server change, and closes the sheet.
 */
export function AbonementPickerSheet({
  memberName,
  present,
  options,
  selectedId,
  clubHasDirections,
  busy,
  onSelect,
  onClose,
}: {
  memberName: string
  present: boolean
  options: readonly VisitAbonement[]
  selectedId: string | null
  clubHasDirections: boolean
  busy: boolean
  onSelect: (subscriptionId: string) => void
  onClose: () => void
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
        onAccessibilityEscape={onClose}
        // Structural, not a control: it only catches taps outside the sheet.
        accessibilityRole="none"
      >
        <Pressable
          style={[
            styles.sheet,
            compact ? styles.sheetBottom : styles.sheetCenter,
            {
              maxHeight: height * 0.9,
              // Android draws edge-to-edge: keep the buttons above the
              // system navigation bar.
              paddingBottom: theme.spacing(5) + (compact ? insets.bottom : 0),
            },
          ]}
          accessibilityRole="none"
          onPress={() => {
            /* swallow, so a tap inside the sheet doesn't dismiss it */
          }}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Списать с абонемента</Text>
            <Text style={styles.meta}>
              {memberName}
              {present
                ? " · отмечен, занятие перенесётся на выбранный абонемент"
                : " · выбор применится при отметке"}
            </Text>
            <AbonementOptionList
              options={options}
              selectedId={selectedId}
              onSelect={onSelect}
              clubHasDirections={clubHasDirections}
              disabled={busy}
            />
            {busy && <ActivityIndicator color={theme.colors.accent} />}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>Закрыть</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.spacing(2) },
    option: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    optionSelected: { borderColor: theme.colors.accent },
    pressed: { opacity: 0.7 },
    radio: {
      width: 20,
      height: 20,
      marginTop: 1,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: theme.colors.accent },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.accent,
    },
    optionBody: { flex: 1, gap: theme.spacing(1) },
    planName: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    detail: { fontSize: 13, color: theme.colors.muted },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing(1),
      marginTop: theme.spacing(1),
    },
    // Shaped like a DirectionTag chip, without the color dot: no direction.
    clubWide: {
      paddingHorizontal: theme.spacing(2) + 2,
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "600",
      overflow: "hidden",
    },
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
      paddingHorizontal: theme.spacing(5),
      ...theme.shadows.sm,
    },
    sheetBottom: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    sheetCenter: { maxWidth: 460, borderRadius: theme.radius.lg },
    scroll: { flexGrow: 0 },
    content: { gap: theme.spacing(3) },
    title: { fontSize: 20, fontWeight: "700", color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
    closeButton: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    closeText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  })
