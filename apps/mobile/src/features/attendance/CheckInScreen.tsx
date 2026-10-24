import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { CenteredColumn } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { CONTROL_MAX_WIDTH } from "../../shared/useResponsive"
import { SafeAreaView } from "react-native-safe-area-context"

import { selfCheckIn, type SelfCheckInResult } from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"
import { packGuidance } from "../subscription/subscription-state"

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

  const guidance = result ? packGuidance(result.classesRemaining) : null

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Missed by the desktop pass that wrapped the other member screens: the
          code field and its button stretched to 1156px next to the sidebar. */}
      <CenteredColumn>
      <View style={styles.header}>
        {/* alignSelf so the target is the label, not the whole header row —
            a Pressable with no width stretches, and a stray tap anywhere on
            that line navigated away. */}
        {/* Asymmetric slop: the label is a 13px caption, so it needs a lot of
            vertical room to be a comfortable target, but the extra area below
            it must not reach far into the title underneath. */}
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 16, bottom: 10, left: 12, right: 20 }}
          style={styles.backButton}
          accessibilityLabel="Назад"
        >
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
          {result.classesRemaining !== null && !guidance && (
            <Text style={styles.resultClasses}>
              Осталось занятий: {result.classesRemaining}
            </Text>
          )}
          {guidance && <Text style={styles.resultGuidance}>{guidance.text}</Text>}
          <Pressable
            onPress={() =>
              navigation.canGoBack()
                ? navigation.goBack()
                : navigation.navigate("Courses")
            }
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
      </CenteredColumn>
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
    backButton: { alignSelf: "flex-start" },
    back: { ...theme.typography.label, color: theme.colors.accent },
    title: { ...theme.typography.title, color: theme.colors.text },
    subtitle: { ...theme.typography.body, color: theme.colors.muted },
    // A 6-character code and its button don't want the full reading column.
    form: {
      padding: theme.spacing(5),
      gap: theme.spacing(3),
      maxWidth: CONTROL_MAX_WIDTH + theme.spacing(10),
    },
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
    resultGuidance: { ...theme.typography.body, color: theme.colors.accent },
  })
