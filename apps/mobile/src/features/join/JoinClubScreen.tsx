import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { navigateToTab, type RootStackParamList } from "../../app/navigation"
import { joinWorkspaceByCode } from "../../shared/api/join"
import { fetchMe, type Me } from "../../shared/api/me"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import {
  formatJoinCodeInput,
  joinCodeFromInput,
  joinCodeInputFromText,
  SCAN_QR_HINT,
} from "./join-code"
import { doneAction, joinResultView, type JoinResultView } from "./join-result"

type Props = NativeStackScreenProps<RootStackParamList, "JoinClub">

type Panel = Extract<JoinResultView, { action: "panel" }>

const panelToneStyle = (
  styles: ReturnType<typeof makeStyles>,
  tone: Panel["tone"],
) =>
  tone === "success"
    ? styles.panelSuccess
    : tone === "info"
      ? styles.panelInfo
      : styles.panelError

export function JoinClubScreen({ navigation, route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspaces, refresh } = useAuth()
  const { showToast } = useToast()
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)

  const [me, setMe] = useState<Me | null>(null)
  const [meFailed, setMeFailed] = useState(false)
  const [code, setCode] = useState(() =>
    formatJoinCodeInput(route.params?.code ?? ""),
  )
  const [firstname, setFirstname] = useState("")
  const [lastname, setLastname] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)

  const loadMe = useCallback(() => {
    setMeFailed(false)
    void fetchMe()
      .then(setMe)
      .catch(() => setMeFailed(true))
  }, [])

  useEffect(() => {
    loadMe()
  }, [loadMe])

  // A new link while this screen is open updates the field.
  const linkCode = route.params?.code
  useEffect(() => {
    if (linkCode) {
      setCode(formatJoinCodeInput(linkCode))
      setPanel(null)
      setError(null)
    }
  }, [linkCode])

  const needsName = me ? !me.firstname?.trim() : false
  const parsed = joinCodeFromInput(code)
  const names = { firstname: firstname.trim(), lastname: lastname.trim() }
  const canSubmit =
    !!me &&
    !submitting &&
    parsed.code !== null &&
    (!needsName || (names.firstname !== "" && names.lastname !== ""))

  const submit = async () => {
    if (!canSubmit || parsed.code === null) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await joinWorkspaceByCode({
        code: parsed.code,
        ...(needsName ? names : {}),
      })
      const view = joinResultView(res)
      if (view.action === "enter") {
        showToast(view.toast, "success")
        const onboarding = workspaces.length === 0
        await refresh({ activate: res.workspaceId })
        if (!onboarding) navigateToTab("Home")
        return
      }
      setPanel(view)
    } catch (e) {
      setError(
        errorMessage(e, "Не удалось отправить заявку. Попробуйте ещё раз."),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const done = () => {
    if (panel?.tone === "error") {
      setPanel(null)
      setCode("")
      return
    }
    const action = doneAction({
      onboarding: workspaces.length === 0,
      canGoBack: navigation.canGoBack(),
    })
    if (action === "popToOnboarding") navigation.popTo("Onboarding")
    else if (action === "goBack") navigation.goBack()
    else navigateToTab("Home")
  }

  const showScanHint = () => showAlert(SCAN_QR_HINT.title, SCAN_QR_HINT.message)

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <KeyboardAvoidingContainer>
        <ScrollView
          ref={scrollRef}
          {...keyboardScroll}
          contentContainerStyle={styles.center}
          keyboardShouldPersistTaps="handled"
        >
          {panel ? (
            <View style={[styles.panel, panelToneStyle(styles, panel.tone)]}>
              <Text style={styles.panelTitle}>{panel.title}</Text>
              <Text style={styles.panelBody}>{panel.body}</Text>
              <Pressable
                onPress={done}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonText}>{panel.primary}</Text>
              </Pressable>
            </View>
          ) : meFailed ? (
            <ErrorRetry
              message="Не удалось загрузить профиль"
              onRetry={loadMe}
            />
          ) : !me ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <View style={styles.form}>
              <Text style={styles.label}>Код клуба</Text>
              <TextInput
                style={[styles.input, styles.code]}
                value={code}
                onChangeText={(text) => {
                  setCode(joinCodeInputFromText(text))
                  setError(null)
                }}
                placeholder="ABCD-2345"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType={Platform.select({
                  android: "visible-password",
                  ios: "ascii-capable",
                })}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                editable={!submitting}
                autoFocus={!route.params?.code}
              />
              <Text style={styles.helper}>
                {parsed.error ??
                  "8 символов — их даёт тренер или администратор клуба"}
              </Text>

              {needsName && (
                <>
                  <Text style={styles.label}>Имя</Text>
                  <TextInput
                    style={styles.input}
                    value={firstname}
                    onChangeText={setFirstname}
                    autoComplete="given-name"
                    textContentType="givenName"
                    editable={!submitting}
                  />
                  <Text style={styles.label}>Фамилия</Text>
                  <TextInput
                    style={styles.input}
                    value={lastname}
                    onChangeText={setLastname}
                    autoComplete="family-name"
                    textContentType="familyName"
                    editable={!submitting}
                  />
                  <Text style={styles.helper}>
                    Клуб увидит ваше имя в заявке
                  </Text>
                </>
              )}

              <Pressable
                onPress={() => void submit()}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.button,
                  !canSubmit && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonText}>Вступить</Text>
                )}
              </Pressable>

              <Pressable onPress={showScanHint} hitSlop={8}>
                <Text style={styles.linkCenter}>{SCAN_QR_HINT.link}</Text>
              </Pressable>

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingContainer>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flexGrow: 1,
    justifyContent: "center",
    // A phone-width form on tablets instead of a field spanning the screen.
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
    paddingVertical: theme.spacing(4),
    paddingHorizontal: theme.spacing(6),
  },
  form: { gap: theme.spacing(3) },
  label: { ...theme.typography.label, marginBottom: 4 },
  helper: { color: theme.colors.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing(4),
    height: 52,
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
  },
  code: {
    fontSize: 24,
    textAlign: "center",
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.full,
    paddingVertical: theme.spacing(4),
    alignItems: "center",
    marginTop: theme.spacing(1),
    ...theme.shadows.sm,
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  linkCenter: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: theme.spacing(2),
  },
  errorBox: {
    padding: theme.spacing(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.dangerSoft,
  },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  panel: {
    gap: theme.spacing(3),
    padding: theme.spacing(5),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceMuted,
  },
  panelTitle: {
    ...theme.typography.title,
    fontSize: 22,
    color: theme.colors.text,
  },
  panelBody: { ...theme.typography.body, color: theme.colors.muted },
  panelSuccess: { borderLeftWidth: 4, borderLeftColor: theme.colors.success },
  panelInfo: { borderLeftWidth: 4, borderLeftColor: theme.colors.accent },
  panelError: { borderLeftWidth: 4, borderLeftColor: theme.colors.danger },
})
