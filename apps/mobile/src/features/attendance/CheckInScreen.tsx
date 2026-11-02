import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { CONTROL_MAX_WIDTH } from "../../shared/useResponsive"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  previewSelfCheckIn,
  selfCheckIn,
  type SelfCheckInPreview,
  type SelfCheckInResult,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { navigateToTab, type RootStackParamList } from "../../app/navigation"
import { packGuidance } from "../subscription/subscription-state"
import { useDirections } from "../directions/useDirections"
import { AbonementOptionList } from "./AbonementPicker"
import { checkInAbonementLine, checkInNeedsChoice } from "./roster-helpers"

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
  const vocabulary = useVocabulary()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SelfCheckInResult | null>(null)
  // Set only while a member with several eligible abonements picks one.
  const [preview, setPreview] = useState<SelfCheckInPreview | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The member had several abonements for this class: the result then names
  // the one the visit went to. With one, the result reads as it always did.
  const [manyAbonements, setManyAbonements] = useState(false)
  const clubHasDirections = useDirections(workspace?.workspaceId).length > 0

  const checkIn = async (trimmed: string, subscriptionId?: string) => {
    if (!workspace) return
    const res = await selfCheckIn({
      workspaceId: workspace.workspaceId,
      code: trimmed,
      subscriptionId,
    })
    setPreview(null)
    setResult(res)
    haptics.light()
  }

  // Look first: one abonement (or an already marked visit) checks in straight
  // away, exactly as before; several stop on «Спишется с:».
  const submit = async () => {
    const trimmed = code.trim()
    if (!workspace || trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    setPreview(null)
    try {
      const p = await previewSelfCheckIn({
        workspaceId: workspace.workspaceId,
        code: trimmed,
      })
      setManyAbonements((p.abonementOptions?.length ?? 0) >= 2)
      if (checkInNeedsChoice(p)) {
        setSelectedId(
          p.abonement?.subscriptionId ??
            p.abonementOptions[0]?.subscriptionId ??
            null,
        )
        setPreview(p)
      } else {
        await checkIn(trimmed)
      }
    } catch (err) {
      setError(errorMessage(err, "Не удалось отметиться"))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      await checkIn(code.trim(), selectedId ?? undefined)
    } catch (err) {
      setError(errorMessage(err, "Не удалось отметиться"))
    } finally {
      setBusy(false)
    }
  }

  const guidance = result ? packGuidance(result.classesRemaining) : null
  const abonementLine =
    result?.abonement && manyAbonements
      ? checkInAbonementLine(result.abonement)
      : null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      {/* Missed by the desktop pass that wrapped the other member screens: the
          code field and its button stretched to 1156px next to the sidebar. */}
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>
          Введите код, который показал {vocabulary.coach.nom}.
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
          {abonementLine && (
            <Text style={styles.resultClasses}>{abonementLine}</Text>
          )}
          {result.classesRemaining !== null && !guidance && !abonementLine && (
            <Text style={styles.resultClasses}>
              Осталось занятий: {result.classesRemaining}
            </Text>
          )}
          {guidance && <Text style={styles.resultGuidance}>{guidance.text}</Text>}
          <Pressable
            onPress={() =>
              navigation.canGoBack()
                ? navigation.goBack()
                : navigateToTab("Home")
            }
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Готово</Text>
          </Pressable>
        </View>
      ) : preview ? (
        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.resultSession}>
            {preview.sessionTitle} · {fmtTime(preview.startAt)}
          </Text>
          <Text style={styles.chooseLabel}>Спишется с:</Text>
          <AbonementOptionList
            options={preview.abonementOptions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            clubHasDirections={clubHasDirections}
            disabled={busy}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            onPress={() => void confirm()}
            disabled={busy || !selectedId}
            style={({ pressed }) => [
              styles.button,
              (busy || !selectedId) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.buttonText}>Отметиться</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setPreview(null)
              setError(null)
            }}
            disabled={busy}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Другой код</Text>
          </Pressable>
        </ScrollView>
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
    },
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
    secondaryButton: {
      borderRadius: theme.radius.full,
      paddingVertical: theme.spacing(3),
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    secondaryButtonText: {
      color: theme.colors.text,
      fontWeight: "600",
      fontSize: 15,
    },
    chooseLabel: { ...theme.typography.label, color: theme.colors.muted },
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
