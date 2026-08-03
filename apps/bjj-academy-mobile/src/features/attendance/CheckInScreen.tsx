import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"

import { selfCheckIn, type SelfCheckInResult } from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "CheckIn">

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })

export function CheckInScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SelfCheckInResult | null>(null)

  const submit = async () => {
    const trimmed = code.trim()
    if (!workspace || trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await selfCheckIn({
        workspaceId: workspace.workspaceId,
        code: trimmed,
      })
      setResult(res)
      haptics.light()
    } catch (err) {
      setError(errorMessage(err, "Не удалось отметиться"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ Назад</Text>
        </Pressable>
        <Text style={styles.title}>Отметиться на тренировке</Text>
        <Text style={styles.subtitle}>
          Введите код, который показал тренер.
        </Text>
      </View>

      {result ? (
        <View style={styles.resultCard}>
          <Text style={styles.resultOk}>
            {result.checkedIn ? "Вы отмечены ✓" : "Вы уже были отмечены"}
          </Text>
          <Text style={styles.resultSession}>
            {result.sessionTitle} · {fmtTime(result.startAt)}
          </Text>
          {result.classesRemaining !== null && (
            <Text style={styles.resultClasses}>
              Осталось занятий: {result.classesRemaining}
            </Text>
          )}
          <Pressable
            onPress={() => {
              setResult(null)
              setCode("")
            }}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Готово</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="Код (напр. ABC234)"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            maxLength={12}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            onPress={() => void submit()}
            disabled={busy || code.trim().length === 0}
            style={({ pressed }) => [
              styles.button,
              (busy || code.trim().length === 0) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.buttonText}>Отметиться</Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(4),
      gap: theme.spacing(1),
    },
    back: { ...theme.typography.label, color: theme.colors.accent },
    title: { ...theme.typography.title, color: theme.colors.text },
    subtitle: { ...theme.typography.body, color: theme.colors.muted },
    form: { padding: theme.spacing(5), gap: theme.spacing(3) },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(4),
      fontSize: 24,
      letterSpacing: 4,
      textAlign: "center",
      color: theme.colors.text,
    },
    error: { color: theme.colors.danger, ...theme.typography.body },
    button: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      color: theme.colors.accentText,
      fontWeight: "700",
      fontSize: 16,
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    resultCard: {
      margin: theme.spacing(5),
      padding: theme.spacing(5),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(2),
    },
    resultOk: { ...theme.typography.title, color: theme.colors.accent },
    resultSession: { ...theme.typography.body, color: theme.colors.text },
    resultClasses: { ...theme.typography.body, color: theme.colors.muted },
  })
