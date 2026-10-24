import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { updateMe, type Me } from "../../shared/api/me"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

// Students sign up with an email only; this is where they become a name in
// the coach's lists and the club leaderboard instead of an address.
export function EditNameModal({
  me,
  onClose,
  onSaved,
}: {
  me: Me
  onClose: () => void
  onSaved: (me: Me) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [firstname, setFirstname] = useState(me.firstname ?? "")
  const [lastname, setLastname] = useState(me.lastname ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstnameRef = useRef<React.ElementRef<typeof TextInput>>(null)
  const lastnameRef = useRef<React.ElementRef<typeof TextInput>>(null)

  // `autoFocus` inside a Modal places the caret but doesn't open the Android
  // keyboard — the window isn't focused yet — so the first field needed a
  // second tap. Focusing once the modal has settled opens it.
  useEffect(() => {
    const timer = setTimeout(() => firstnameRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await updateMe({ firstname, lastname }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить имя."))
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
      {/* Padding on Android too: edge-to-edge doesn't resize for the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
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
            <Text style={styles.title}>Как вас зовут?</Text>
            <Text style={styles.hint}>
              Имя одно на все ваши клубы: его видят тренеры и участники — в
              группах и рейтинге.
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>Имя</Text>
              <TextInput
                ref={firstnameRef}
                style={styles.input}
                value={firstname}
                onChangeText={setFirstname}
                placeholder="Имя"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
                maxLength={100}
                returnKeyType="next"
                onSubmitEditing={() => lastnameRef.current?.focus()}
                submitBehavior="submit"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Фамилия</Text>
              <TextInput
                ref={lastnameRef}
                style={styles.input}
                value={lastname}
                onChangeText={setLastname}
                placeholder="Фамилия"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="words"
                autoComplete="family-name"
                textContentType="familyName"
                maxLength={100}
                returnKeyType="done"
                onSubmitEditing={() => void save()}
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
                disabled={saving}
                accessibilityRole="button"
                style={[styles.button, styles.buttonPrimary]}
              >
                {saving ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>Сохранить</Text>
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
    hint: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
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
    buttonPrimaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
  })
