import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
  type ViewInstance,
} from "react-native"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
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
import { getMyCheckInCard } from "../../shared/api/check-in-card"
import { fetchMe } from "../../shared/api/me"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  cardForViewer,
  checkInCardKey,
  checkInCardView,
} from "../../shared/check-in-card-store"
import { useVocabulary } from "../../shared/use-vocabulary"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
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
  // The code field and «Отметиться» under it stay above the keyboard together.
  const scrollRef = useRef<ScrollViewInstance>(null)
  const formRef = useRef<ViewInstance>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef, formRef)
  const [result, setResult] = useState<SelfCheckInResult | null>(null)
  // Set only while a member with several eligible abonements picks one.
  const [preview, setPreview] = useState<SelfCheckInPreview | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The member had several abonements for this class: the result then names
  // the one the visit went to. With one, the result reads as it always did.
  const [manyAbonements, setManyAbonements] = useState(false)
  const clubHasDirections = useDirections(workspace?.workspaceId).length > 0
  const workspaceId = workspace?.workspaceId

  // «Моя карта»: painted from the phone at once (no connection needed at the
  // door), refreshed in the background. Same `me` key as Home, so the
  // person is known offline; the card is per person, the child's in a
  // child's profile.
  const me = useCachedResource(
    workspaceId ? `me:${workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  const meId = me.data?.id ?? null
  const cardRes = useCachedResource(
    workspaceId && meId ? checkInCardKey(meId) : null,
    useCallback(
      async () => await getMyCheckInCard({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const card = cardForViewer(cardRes.data, meId)
  const cardView = checkInCardView({
    card,
    loading: me.loading || (meId !== null && cardRes.loading),
  })

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
        // Padding on Android too: edge-to-edge doesn't resize for the keyboard.
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.cardBlock}>
              <Text style={styles.sectionTitle}>Моя карта</Text>
              {cardView === "card" && card ? (
                <>
                  <View style={styles.qrPlate}>
                    <Image
                      source={{ uri: card.qrPngDataUrl }}
                      style={styles.qr}
                      accessibilityLabel={`QR-код карты: ${card.name}`}
                    />
                  </View>
                  <Text style={styles.cardName}>{card.name}</Text>
                  <Text style={styles.cardHint}>
                    Покажите {vocabulary.coach.dat} у входа
                  </Text>
                </>
              ) : cardView === "loading" ? (
                <View style={styles.qrPlaceholder}>
                  <ActivityIndicator color={theme.colors.accent} />
                </View>
              ) : (
                <Text style={styles.cardHint}>
                  Карта появится, когда будет интернет
                </Text>
              )}
            </View>

            <View ref={formRef} style={styles.form} collapsable={false}>
              <Text style={styles.sectionTitle}>Или введите код занятия</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="ABC234"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                // The code is Latin: a Russian phone would open Cyrillic keys.
                keyboardType={Platform.select({
                  android: "visible-password",
                  ios: "ascii-capable",
                })}
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
          </ScrollView>
        </KeyboardAvoidingContainer>
      )}
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    scroll: { paddingBottom: theme.spacing(5) },
    // The card leads: what the member shows at the door, with no typing.
    cardBlock: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(5),
      alignItems: "center",
      gap: theme.spacing(2),
    },
    sectionTitle: {
      ...theme.typography.label,
      color: theme.colors.muted,
      alignSelf: "flex-start",
    },
    // A QR reads best dark on white, in the dark theme too.
    qrPlate: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.onOverlay,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    qr: { width: 240, height: 240 },
    qrPlaceholder: {
      width: 240 + theme.spacing(6),
      height: 240 + theme.spacing(6),
      alignItems: "center",
      justifyContent: "center",
    },
    cardName: { ...theme.typography.title, color: theme.colors.text, textAlign: "center" },
    cardHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
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
