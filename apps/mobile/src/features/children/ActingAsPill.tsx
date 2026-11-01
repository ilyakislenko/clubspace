import Ionicons from "@expo/vector-icons/Ionicons"
import React, { useState } from "react"
import { Modal, StyleSheet, Text } from "react-native"

import { useAuth } from "../../shared/auth-context"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { dependentName } from "./children-helpers"
import { ProfileSwitcher } from "./ProfileSwitcher"

/**
 * «Профиль: Миша» — always in view while the guardian acts for a child, so
 * they know whose schedule, check-in and abonement they are looking at. Opens
 * the profile switcher. Renders nothing as the guardian.
 */
export function ActingAsPill() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { actingAs } = useAuth()
  const [open, setOpen] = useState(false)

  if (!actingAs) return null
  const name = dependentName(actingAs)

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Профиль ребёнка: ${name}. Сменить профиль`}
        hitSlop={6}
        style={styles.pill}
      >
        <Ionicons name="people" size={14} color={theme.colors.accentText} />
        <Text style={styles.pillText} numberOfLines={1}>
          Профиль: {name}
        </Text>
        <Ionicons name="chevron-down" size={14} color={theme.colors.accentText} />
      </Pressable>
      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
          statusBarTranslucent
        >
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            // Structural, not a control: it only catches taps outside the sheet.
            accessibilityRole="none"
          >
            <Pressable
              style={styles.sheet}
              accessibilityRole="none"
              onPress={() => {
                /* swallow, so a tap inside the sheet doesn't dismiss it */
              }}
            >
              <ProfileSwitcher />
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                style={styles.close}
              >
                <Text style={styles.closeText}>Закрыть</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      maxWidth: "100%",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    pillText: {
      flexShrink: 1,
      color: theme.colors.accentText,
      fontSize: 13,
      fontWeight: "700",
    },
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      maxWidth: 460,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      padding: theme.spacing(5),
      gap: theme.spacing(4),
      ...theme.shadows.sm,
    },
    close: { alignItems: "center", paddingVertical: theme.spacing(2) },
    closeText: { color: theme.colors.muted, fontSize: 15, fontWeight: "600" },
  })
