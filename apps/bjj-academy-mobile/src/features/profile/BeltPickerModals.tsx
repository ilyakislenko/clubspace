import React from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { theme } from "../../shared/theme"
import { BELT_OPTIONS } from "./belt"
import { type BeltRank } from "./preferences-store"

type BeltPickerProps = {
  visible: boolean
  currentBelt: BeltRank | null
  currentStripes: number
  onSelectBelt: (rank: BeltRank | null, stripes: number) => void
  onClose: () => void
}

export function BeltPickerModal({
  visible,
  currentBelt,
  currentStripes,
  onSelectBelt,
  onClose,
}: BeltPickerProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={styles.modalSheet}
          onPress={() => {
            /* swallow the press so tapping the sheet doesn't hit the
               backdrop and dismiss the modal */
          }}
        >
          <Text style={styles.modalTitle}>Какой у вас пояс?</Text>
          <ScrollView style={styles.modalList}>
            {BELT_OPTIONS.map((option) => {
              const active = currentBelt === option.rank
              return (
                <Pressable
                  key={option.rank}
                  onPress={() => {
                    onClose()
                    onSelectBelt(option.rank, currentStripes)
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && styles.modalRowPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.modalSwatch,
                      {
                        backgroundColor: option.color,
                        borderColor: option.color,
                      },
                    ]}
                  />
                  <Text style={styles.modalRowLabel}>{option.label}</Text>
                  {active && <Text style={styles.modalCheck}>✓</Text>}
                </Pressable>
              )
            })}
          </ScrollView>
          {currentBelt && (
            <Pressable
              onPress={() => {
                onClose()
                onSelectBelt(null, 0)
              }}
              style={({ pressed }) => [
                styles.modalRow,
                styles.modalDestructive,
                pressed && styles.modalRowPressed,
              ]}
            >
              <Text style={styles.modalDestructiveText}>Сбросить</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.modalRow,
              styles.modalCancel,
              pressed && styles.modalRowPressed,
            ]}
          >
            <Text style={styles.modalCancelText}>Отмена</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

type StripesPickerProps = {
  visible: boolean
  currentStripes: number
  onSelectStripes: (n: number) => void
  onClose: () => void
}

export function StripesPickerModal({
  visible,
  currentStripes,
  onSelectStripes,
  onClose,
}: StripesPickerProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={styles.modalSheet}
          onPress={() => {
            /* swallow the press so tapping the sheet doesn't hit the
               backdrop and dismiss the modal */
          }}
        >
          <Text style={styles.modalTitle}>Сколько полосок?</Text>
          {[0, 1, 2, 3, 4].map((n) => {
            const active = currentStripes === n
            return (
              <Pressable
                key={n}
                onPress={() => {
                  onClose()
                  onSelectStripes(n)
                }}
                style={({ pressed }) => [
                  styles.modalRow,
                  pressed && styles.modalRowPressed,
                ]}
              >
                <Text style={styles.modalRowLabel}>{n}</Text>
                {active && <Text style={styles.modalCheck}>✓</Text>}
              </Pressable>
            )
          })}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.modalRow,
              styles.modalCancel,
              pressed && styles.modalRowPressed,
            ]}
          >
            <Text style={styles.modalCancelText}>Отмена</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing(2),
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(6),
    gap: theme.spacing(1),
    maxHeight: "80%",
  },
  modalTitle: {
    ...theme.typography.label,
    paddingHorizontal: theme.spacing(3),
    paddingBottom: theme.spacing(2),
  },
  modalList: {
    flexGrow: 0,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
  },
  modalRowPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  modalSwatch: {
    width: 28,
    height: 18,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
  },
  modalRowLabel: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    fontWeight: "500",
  },
  modalCheck: {
    fontSize: 16,
    color: theme.colors.accent,
    fontWeight: "800",
  },
  modalDestructive: {
    marginTop: theme.spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing(3),
  },
  modalDestructiveText: {
    fontSize: 15,
    color: theme.colors.danger,
    fontWeight: "600",
  },
  modalCancel: {
    marginTop: theme.spacing(1),
    backgroundColor: theme.colors.surfaceMuted,
  },
  modalCancelText: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: "700",
    textAlign: "center",
    flex: 1,
  },
})
