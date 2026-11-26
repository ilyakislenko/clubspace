import { usePreventRemove } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  previewClubMessage,
  sendClubMessage,
  type ClubMessagePreview,
  type PreviewClubMessageInput,
} from "../../shared/api/messages"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { invalidateResource } from "../../shared/cache/cache-events"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { Icon } from "../../shared/components/Icon"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import { AT_RISK_RESOURCE } from "../retention/retention-helpers"
import { isAdminScope } from "../schedule/substitution-helpers"
import {
  asFlag,
  asIdList,
  composeError,
  hasDraft,
  isQuietHour,
  previewSentence,
  sendButtonLabel,
  sendConfirmTitle,
  sentToast,
} from "./club-messages"

// The server's SendClubMessageInput: title 1–120, body 1–2000.
const LIMITS = { title: 120, body: 2000 }

type Props = NativeStackScreenProps<RootStackParamList, "ComposeClubMessage">

/**
 * Staff write to one student (from «Кому позвонить» or the student's
 * abonement) or to a group (from its class). The audience is fixed by where
 * they came from; the history and the other segments are in the admin panel.
 */
export function ComposeClubMessageScreen({ navigation, route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollViewInstance>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const { workspace } = useAuth()
  const vocabulary = useVocabulary()
  const { showToast } = useToast()
  const workspaceId = workspace?.workspaceId
  const { segment, audienceLabel } = route.params
  const memberIds = asIdList(route.params.memberIds)
  const groupIds = asIdList(route.params.groupIds)
  const logContact = asFlag(route.params.logContact)
  const isDirect = segment === "MEMBERS" && memberIds.length === 1
  // «Служебное» ignores the opt-out and the club mute: sport leads only, and
  // never for a direct message (already exempt from both).
  const canMarkService = !!workspace && isAdminScope(workspace) && !isDirect

  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [urgent, setUrgent] = useState(false)
  const [isService, setIsService] = useState(false)
  // Offered only while the club has e-mail for messages switched on.
  const [withEmail, setWithEmail] = useState(false)
  // The answer for one request (audience + flags). Only the answer for the
  // current request counts: a stale or failed one blocks sending, so the
  // confirm always names the real number of recipients.
  const [previewState, setPreviewState] = useState<{
    key: string
    data: ClubMessagePreview | null
    error: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Sent: leaving is the success path, not a lost draft.
  const sentRef = useRef(false)

  // Back (button, swipe, Android back) with text typed asks first: a typed
  // message vanished without a word.
  usePreventRemove(hasDraft(title, body), ({ data }) => {
    if (sentRef.current) {
      navigation.dispatch(data.action)
      return
    }
    showAlert("Не отправлять сообщение?", "Набранный текст пропадёт.", [
      { text: "Остаться", style: "cancel" },
      {
        text: "Не отправлять",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ])
  })

  const memberKey = memberIds.join(",")
  const groupKey = groupIds.join(",")
  const audience = useMemo<PreviewClubMessageInput>(
    () =>
      segment === "GROUPS"
        ? { segment, groupIds: groupKey.split(",") }
        : { segment, memberIds: memberKey.split(",") },
    [segment, memberKey, groupKey],
  )
  const service = isService && canMarkService
  const previewKey = `${segment}|${memberKey}|${groupKey}|${urgent}|${service}`

  // The preview depends on the audience and the flags, not on the text.
  useEffect(() => {
    if (!workspaceId) return
    let live = true
    previewClubMessage({
      workspaceId,
      data: { ...audience, urgent, isService: service },
    })
      .then((data) => {
        if (live) setPreviewState({ key: previewKey, data, error: null })
      })
      .catch((e) => {
        if (live) {
          setPreviewState({
            key: previewKey,
            data: null,
            error: errorMessage(e, "Не удалось посчитать получателей"),
          })
        }
      })
    return () => {
      live = false
    }
  }, [workspaceId, audience, urgent, service, previewKey])

  if (!workspace || !workspaceId) return null

  const current = previewState?.key === previewKey ? previewState : null
  const preview = current?.data ?? null
  const deferred = preview?.deferredByQuietHours ?? false
  const canSend = !sending && !!preview && preview.recipients > 0

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const sent = await sendClubMessage({
        workspaceId,
        data: {
          ...audience,
          title: title.trim(),
          body: body.trim(),
          urgent,
          isService: service,
          withEmail: withEmail && (preview?.emailEnabled ?? false),
          ...(logContact ? { logContact: true } : {}),
        },
      })
      // Written from «Кому позвонить»: it counts as «Связались», so the
      // member leaves the list on every surface.
      if (logContact) invalidateResource(AT_RISK_RESOURCE, workspaceId)
      showToast(sentToast(sent.status), "success")
      sentRef.current = true
      navigation.goBack()
    } catch (e) {
      // The daily limits and the scope come back as a sentence: show it here.
      setError(errorMessage(e, "Не удалось отправить сообщение"))
      setSending(false)
    }
  }

  const submit = () => {
    if (!canSend) return
    const invalid = composeError(title, body, LIMITS)
    if (invalid) {
      setError(invalid)
      return
    }
    const confirm = sendConfirmTitle(preview.recipients)
    if (!confirm) {
      void send()
      return
    }
    // An urgent message goes out at once: say so when it is night at the club.
    showAlert(
      confirm,
      urgent && isQuietHour(new Date(), preview.timezone)
        ? "Сейчас ночь у учеников."
        : undefined,
      [
        { text: "Отмена", style: "cancel" },
        { text: "Отправить", onPress: () => void send() },
      ],
    )
  }

  const checkbox = (
    label: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ) => (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.check}
    >
      <Icon
        name={checked ? "checkbox" : "square-outline"}
        size={22}
        color={checked ? theme.colors.accent : theme.colors.muted}
      />
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.field}>
              <Text style={styles.label}>Кому</Text>
              <Text style={styles.audience}>{audienceLabel}</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Заголовок</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={LIMITS.title}
                placeholder={`Например: ${vocabulary.session.gen} 4 ноября не будет`}
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
                accessibilityLabel="Заголовок"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Текст</Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                maxLength={LIMITS.body}
                multiline
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, styles.textArea]}
                accessibilityLabel="Текст"
              />
              <Text style={styles.counter}>
                {body.length} / {LIMITS.body}
              </Text>
            </View>

            {canMarkService &&
              checkbox(
                "Служебное — дойдёт и тем, кто отключил сообщения клуба",
                isService,
                setIsService,
              )}
            {checkbox("Срочно — отправить сейчас, даже ночью", urgent, setUrgent)}
            {/* The club's switch, not the audience's: the last answer holds
                while the flags' preview reloads. */}
            {previewState?.data?.emailEnabled &&
              checkbox("Также отправить на e-mail", withEmail, setWithEmail)}

            {preview ? (
              <Text style={styles.preview}>
                {previewSentence(preview, { urgent, withEmail })}
              </Text>
            ) : current?.error ? (
              <Text style={styles.error}>{current.error}</Text>
            ) : null}
            <Text style={styles.hint}>
              Пишите о {vocabulary.session.prepPl} клуба. Реклама сторонних
              товаров запрещена.
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={!canSend}
              accessibilityRole="button"
              style={[styles.primary, !canSend && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                {sending ? "Отправляю…" : sendButtonLabel(deferred, urgent)}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    field: { gap: theme.spacing(1) },
    label: { ...theme.typography.caption, color: theme.colors.muted },
    audience: { ...theme.typography.bodyStrong, color: theme.colors.text },
    input: {
      color: theme.colors.text,
      fontSize: 15,
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    textArea: { minHeight: 140, maxHeight: 320, textAlignVertical: "top" },
    counter: {
      ...theme.typography.caption,
      color: theme.colors.muted,
      alignSelf: "flex-end",
    },
    check: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      minHeight: 44,
    },
    checkText: { flex: 1, fontSize: 15, color: theme.colors.text },
    preview: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
    hint: { ...theme.typography.caption, color: theme.colors.muted },
    error: { fontSize: 14, color: theme.colors.danger },
    primary: {
      alignItems: "center",
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 16,
      fontWeight: "600",
    },
    disabled: { opacity: 0.5 },
  })
