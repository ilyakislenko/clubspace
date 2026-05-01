import { brandFromWorkspaceType } from "@bjj-academy/ui-kit/brand"
import React, { useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getAuthApi, storeAuthTokens } from "../../shared/api/client"
import { useAuth } from "../../shared/auth-context"
import { environment } from "../../shared/env"
import { theme } from "../../shared/theme"

export function SignInScreen() {
  const { refresh } = useAuth()
  const brand = brandFromWorkspaceType(environment.brand)

  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async () => {
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await getAuthApi().sendAuthCode({ email: email.trim(), language: "RU" })
      setStep("code")
    } catch {
      setError("Не удалось отправить код. Проверьте email и попробуйте ещё раз.")
    } finally {
      setSubmitting(false)
    }
  }

  const verifyCode = async () => {
    if (!code.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await getAuthApi().signIn({
        email: email.trim(),
        code: code.trim(),
      })
      storeAuthTokens(response)
      await refresh()
    } catch {
      setError("Неверный код. Проверьте письмо или запросите новый.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.center}>
          <Text style={styles.emoji}>{brand.emoji}</Text>
          <Text style={styles.title}>{brand.name}</Text>
          <Text style={styles.subtitle}>{brand.tagline}</Text>

          {step === "email" ? (
            <View style={styles.form}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!submitting}
              />
              <Pressable
                onPress={sendCode}
                disabled={submitting || !email.trim()}
                style={({ pressed }) => [
                  styles.button,
                  (!email.trim() || submitting) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonText}>Получить код</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.emailRow}>
                <Text style={styles.muted}>Отправлено на</Text>
                <Text style={styles.emailText}>{email}</Text>
                <Pressable
                  onPress={() => setStep("email")}
                  disabled={submitting}
                >
                  <Text style={styles.link}>Изменить</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Код</Text>
              <TextInput
                style={[styles.input, styles.code]}
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                editable={!submitting}
              />
              <Pressable
                onPress={verifyCode}
                disabled={submitting || code.length < 4}
                style={({ pressed }) => [
                  styles.button,
                  (code.length < 4 || submitting) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonText}>Войти</Text>
                )}
              </Pressable>

              <Pressable onPress={sendCode} disabled={submitting}>
                <Text style={styles.linkCenter}>
                  Не пришёл код? Отправить ещё раз
                </Text>
              </Pressable>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "stretch",
    paddingHorizontal: theme.spacing(6),
    gap: theme.spacing(3),
  },
  emoji: { fontSize: 48, textAlign: "center" },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    color: theme.colors.text,
  },
  subtitle: {
    textAlign: "center",
    color: theme.colors.muted,
    marginBottom: theme.spacing(2),
  },
  form: { gap: theme.spacing(2) },
  label: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
  },
  code: {
    fontSize: 24,
    textAlign: "center",
    letterSpacing: 8,
    fontVariant: ["tabular-nums"],
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing(3),
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: theme.colors.accentText,
    fontWeight: "600",
    fontSize: 16,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  muted: { color: theme.colors.muted, fontSize: 12 },
  emailText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  link: { color: theme.colors.accent, fontSize: 13, fontWeight: "500" },
  linkCenter: {
    color: theme.colors.muted,
    fontSize: 13,
    textAlign: "center",
    marginTop: theme.spacing(2),
  },
  errorBox: {
    padding: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: "#fee2e2",
  },
  errorText: { color: theme.colors.danger, fontSize: 14 },
})
