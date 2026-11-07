import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native"

import { getAuthApi } from "../../shared/api/client"
import { deleteAccount, fetchSignedInUser } from "../../shared/api/me"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage, retryAfterSeconds } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 60

/**
 * The last step of deleting the account: the server deletes only with a
 * fresh code sent to the account's own address (a signed-in phone alone is
 * not enough). Mails the code on open, then deletes with it; `onDeleted`
 * signs out locally.
 */
export function DeleteAccountModal({
  onClose,
  onDeleted,
}: {
  onClose: () => void
  onDeleted: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [email, setEmail] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<TextInputInstance>(null)

  const sendCode = useCallback(async (address: string) => {
    setSending(true)
    setError(null)
    try {
      await getAuthApi().sendAuthCode({ email: address, language: "RU" })
      setCooldown(RESEND_COOLDOWN_S)
    } catch (e) {
      const wait = retryAfterSeconds(e)
      if (wait) {
        // A code sent a moment ago is still valid: the member can enter it.
        setCooldown(wait)
        return
      }
      setError(errorMessage(e, "Не удалось отправить код."))
    } finally {
      setSending(false)
    }
  }, [])

  // Always the signed-in person's own address, also while acting for a child.
  useEffect(() => {
    let cancelled = false
    void fetchSignedInUser()
      .then((me) => {
        if (cancelled) return
        if (!me.email) {
          setError("У аккаунта нет почты, на которую можно отправить код.")
          return
        }
        setEmail(me.email)
        void sendCode(me.email)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, "Не удалось отправить код."))
      })
    return () => {
      cancelled = true
    }
  }, [sendCode])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // See EditNameModal: `autoFocus` inside a Modal doesn't open the Android
  // keyboard.
  useEffect(() => {
    const timer = setTimeout(() => codeRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const canDelete = code.trim().length === CODE_LENGTH && !deleting

  const confirm = async () => {
    if (!canDelete) return
    setDeleting(true)
    setError(null)
    try {
      await deleteAccount(code.trim())
      onDeleted()
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить аккаунт."))
      setDeleting(false)
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
            <Text style={styles.title}>Подтвердите удаление</Text>
            <Text style={styles.hint}>
              {email
                ? `Мы отправили код на ${email}. Введите его, чтобы удалить аккаунт навсегда.`
                : "Отправляем код на вашу почту…"}
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>Код</Text>
              <TextInput
                ref={codeRef}
                style={[styles.input, styles.code]}
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={CODE_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => void confirm()}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                editable={!deleting}
              />
            </View>

            <Pressable
              onPress={() => email && void sendCode(email)}
              disabled={!email || sending || cooldown > 0}
              accessibilityRole="button"
            >
              <Text style={styles.link}>
                {cooldown > 0
                  ? `Отправить ещё раз через ${cooldown} с`
                  : "Не пришёл код? Отправить ещё раз"}
              </Text>
            </Pressable>

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
                onPress={() => void confirm()}
                disabled={!canDelete}
                accessibilityRole="button"
                accessibilityLabel="Удалить аккаунт"
                style={[
                  styles.button,
                  styles.buttonDanger,
                  !canDelete && styles.buttonDisabled,
                ]}
              >
                {deleting ? (
                  <ActivityIndicator color={theme.colors.danger} />
                ) : (
                  <Text style={styles.buttonDangerText}>Удалить</Text>
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
    code: { letterSpacing: 6, textAlign: "center", fontSize: 20 },
    link: { color: theme.colors.accent, fontSize: 13, textAlign: "center" },
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
    buttonDanger: { backgroundColor: theme.colors.dangerSoft },
    buttonDangerText: {
      color: theme.colors.danger,
      fontSize: 15,
      fontWeight: "700",
    },
    buttonDisabled: { opacity: 0.5 },
  })
