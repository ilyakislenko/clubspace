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

import { updateMe, type Me, type UpdateMeInput } from "../../shared/api/me"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  formatBirthDate,
  maskBirthDate,
  parseBirthDate,
  todayYmd,
} from "../children/children-helpers"

// Students sign up with an email only; this is where they become a name in
// the coach's lists and the club leaderboard instead of an address. From
// «Профиль» (`withBirthDate`) it also takes the optional birth date, which
// only the club's staff see; the name prompts elsewhere stay name-only.
export function EditNameModal({
  me,
  withBirthDate = false,
  onClose,
  onSaved,
}: {
  me: Me
  withBirthDate?: boolean
  onClose: () => void
  onSaved: (me: Me) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [firstname, setFirstname] = useState(me.firstname ?? "")
  const [lastname, setLastname] = useState(me.lastname ?? "")
  const [birth, setBirth] = useState(formatBirthDate(me.dateOfBirth ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstnameRef = useRef<TextInputInstance>(null)
  const lastnameRef = useRef<TextInputInstance>(null)
  const birthRef = useRef<TextInputInstance>(null)

  // `autoFocus` inside a Modal places the caret but doesn't open the Android
  // keyboard — the window isn't focused yet — so the first field needed a
  // second tap. Focusing once the modal has settled opens it.
  useEffect(() => {
    const timer = setTimeout(() => firstnameRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const save = async () => {
    if (saving) return
    const data: UpdateMeInput = { firstname, lastname }
    if (withBirthDate) {
      // Optional: a cleared field removes the date.
      const typed = birth.trim()
      const dateOfBirth = typed ? parseBirthDate(typed, todayYmd(new Date())) : null
      if (typed && !dateOfBirth) {
        setError("Укажите дату рождения в формате ДД.ММ.ГГГГ.")
        return
      }
      // Only a change: the date is audited in every club of the person.
      if (dateOfBirth !== (me.dateOfBirth ?? null)) data.dateOfBirth = dateOfBirth
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(await updateMe(data))
    } catch (e) {
      setError(
        errorMessage(e, withBirthDate ? "Не удалось сохранить профиль." : "Не удалось сохранить имя."),
      )
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
          onAccessibilityEscape={onClose}
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
            <Text style={styles.title}>{withBirthDate ? "Профиль" : "Как вас зовут?"}</Text>
            <Text style={styles.hint}>
              Имя одно на все ваши клубы: его видят в каждом из них — в
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
                returnKeyType={withBirthDate ? "next" : "done"}
                onSubmitEditing={() =>
                  withBirthDate ? birthRef.current?.focus() : void save()
                }
                submitBehavior={withBirthDate ? "submit" : undefined}
              />
            </View>
            {withBirthDate && (
              <View style={styles.field}>
                <Text style={styles.label}>Дата рождения</Text>
                <TextInput
                  ref={birthRef}
                  style={styles.input}
                  value={birth}
                  onChangeText={(text) => setBirth(maskBirthDate(text))}
                  placeholder="ДД.ММ.ГГГГ"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityHint="Необязательно. Например, 07.03.1990"
                  returnKeyType="done"
                  // iOS number pad bar: RN's own label is the English «Done».
                  inputAccessoryViewButtonLabel="Сохранить"
                  onSubmitEditing={() => void save()}
                />
                <Text style={styles.hint}>
                  Видят только сотрудники клуба. Клуб сможет поздравить вас с
                  днём рождения.
                </Text>
              </View>
            )}

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
