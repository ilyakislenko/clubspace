import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { planEditErrorMessage } from "./plan-store"

type Props = {
  heading: string
  // A name (required unless `titleOptional`) and a longer free text.
  titleLabel: string
  titleInitial?: string
  titleOptional?: boolean
  textLabel: string
  textInitial?: string | null
  textPlaceholder?: string
  submitLabel?: string
  // Throws to keep the sheet open with the error shown.
  onSubmit: (title: string, text: string) => Promise<void>
  onClose: () => void
}

// Create / rename a plan (title + description) and edit an item (title + note).
export function PlanTextModal({
  heading,
  titleLabel,
  titleInitial = "",
  titleOptional = false,
  textLabel,
  textInitial,
  textPlaceholder,
  submitLabel = "Сохранить",
  onSubmit,
  onClose,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [title, setTitle] = useState(titleInitial)
  const [text, setText] = useState(textInitial ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<TextInputInstance>(null)

  // Same as EditNameModal: focusing once the modal settled opens the
  // Android keyboard (`autoFocus` alone doesn't).
  useEffect(() => {
    const timer = setTimeout(() => titleRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const canSave = titleOptional || title.trim().length > 0

  const save = async () => {
    if (saving || !canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(title.trim(), text.trim())
    } catch (e) {
      setError(planEditErrorMessage(e, "Не удалось сохранить."))
      setSaving(false)
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          onAccessibilityEscape={onClose}
          accessibilityRole="none"
        >
          <Pressable
            style={styles.sheet}
            accessibilityRole="none"
            onPress={() => {
              /* swallow, so a tap inside the sheet doesn't dismiss it */
            }}
          >
            <Text style={styles.title}>{heading}</Text>
            <View style={styles.field}>
              <Text style={styles.label}>{titleLabel}</Text>
              <TextInput
                ref={titleRef}
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder={titleLabel}
                placeholderTextColor={theme.colors.muted}
                maxLength={120}
                returnKeyType="next"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{textLabel}</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={text}
                onChangeText={setText}
                placeholder={textPlaceholder}
                placeholderTextColor={theme.colors.muted}
                multiline
                textAlignVertical="top"
                maxLength={2000}
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={[styles.button, styles.buttonSecondary]}
              >
                <Text style={styles.buttonSecondaryText}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={() => void save()}
                disabled={saving || !canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || !canSave }}
                style={[
                  styles.button,
                  styles.buttonPrimary,
                  !canSave && styles.buttonDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>{submitLabel}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
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
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    title: { fontSize: 20, fontWeight: "700", color: theme.colors.text },
    field: { gap: theme.spacing(1) },
    label: { ...theme.typography.label },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(3),
      fontSize: 16,
      color: theme.colors.text,
    },
    multiline: { minHeight: 84, maxHeight: 160 },
    error: { color: theme.colors.danger, fontSize: 13 },
    actions: {
      flexDirection: "row",
      gap: theme.spacing(2),
      marginTop: theme.spacing(1),
    },
    button: {
      flex: 1,
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonDisabled: { opacity: 0.5 },
    buttonPrimaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
  })
