import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native"

import {
  addMyDependent,
  updateMyDependent,
  type DependentRelation,
  type MyDependent,
} from "../../shared/api/dependents"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { ConsentCheckbox, RelationPicker } from "./ChildFormParts"
import {
  formatBirthDate,
  maskBirthDate,
  parseBirthDate,
  todayYmd,
} from "./children-helpers"

/**
 * «Добавить ребёнка» (no `child`) or editing a confirmed child's name and
 * birth date. Adding needs the parental consent; the relation is asked once.
 */
export function ChildFormModal({
  child,
  onClose,
  onSaved,
}: {
  child?: MyDependent
  onClose: () => void
  onSaved: (saved: MyDependent) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const editing = child !== undefined
  const [firstname, setFirstname] = useState(child?.firstname ?? "")
  const [lastname, setLastname] = useState(child?.lastname ?? "")
  const [birth, setBirth] = useState(formatBirthDate(child?.dateOfBirth ?? null))
  const [relation, setRelation] = useState<DependentRelation>("PARENT")
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstnameRef = useRef<TextInputInstance>(null)
  const lastnameRef = useRef<TextInputInstance>(null)
  const birthRef = useRef<TextInputInstance>(null)

  // See EditNameModal: autoFocus inside a Modal doesn't open the Android
  // keyboard, focusing once the modal has settled does.
  useEffect(() => {
    const timer = setTimeout(() => firstnameRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const save = async () => {
    if (saving) return
    const first = firstname.trim()
    const last = lastname.trim()
    if (!first) {
      setError("Укажите имя ребёнка.")
      return
    }
    const dateOfBirth = parseBirthDate(birth, todayYmd(new Date()))
    if (!dateOfBirth) {
      setError("Укажите дату рождения в формате ДД.ММ.ГГГГ.")
      return
    }
    if (!editing && !consent) {
      setError("Нужно ваше согласие на обработку данных ребёнка.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = child
        ? await updateMyDependent({
            dependentId: child.id,
            data: { firstname: first, lastname: last || null, dateOfBirth },
          })
        : await addMyDependent({
            firstname: first,
            ...(last ? { lastname: last } : {}),
            dateOfBirth,
            relation,
            consent: true,
          })
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить."))
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
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.title}>
                {editing ? "Данные ребёнка" : "Добавить ребёнка"}
              </Text>
              {!editing && (
                <Text style={styles.hint}>
                  У ребёнка не будет своего входа: вы будете записывать его,
                  отмечать на тренировках и следить за абонементом из своего
                  аккаунта.
                </Text>
              )}

              <View style={styles.field}>
                <Text style={styles.label}>Имя *</Text>
                <TextInput
                  ref={firstnameRef}
                  style={styles.input}
                  value={firstname}
                  onChangeText={setFirstname}
                  placeholder="Имя"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="words"
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
                  maxLength={100}
                  returnKeyType="next"
                  onSubmitEditing={() => birthRef.current?.focus()}
                  submitBehavior="submit"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Дата рождения *</Text>
                <TextInput
                  ref={birthRef}
                  style={styles.input}
                  value={birth}
                  onChangeText={(text) => setBirth(maskBirthDate(text))}
                  placeholder="ДД.ММ.ГГГГ"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityHint="Например, 07.03.2015"
                  returnKeyType="done"
                  onSubmitEditing={() => void save()}
                />
              </View>

              {!editing && (
                <>
                  <RelationPicker value={relation} onChange={setRelation} />
                  <ConsentCheckbox checked={consent} onChange={setConsent} />
                </>
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
                  disabled={saving || (!editing && !consent)}
                  accessibilityRole="button"
                  style={[
                    styles.button,
                    styles.buttonPrimary,
                    !editing && !consent && styles.disabled,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color={theme.colors.accentText} />
                  ) : (
                    <Text style={styles.buttonPrimaryText}>
                      {editing ? "Сохранить" : "Добавить"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
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
      maxHeight: "90%",
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      ...theme.shadows.sm,
    },
    content: { padding: theme.spacing(5), gap: theme.spacing(3) },
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
    disabled: { opacity: 0.5 },
  })
