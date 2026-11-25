import { CameraView, useCameraPermissions } from "expo-camera"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { CardLookup } from "../../shared/api/check-in-card"
import { cardUserId } from "../../shared/check-in-card-store"
import { READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { haptics } from "../../shared/haptics"
import { isWeb } from "../../shared/platform"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { scannerView } from "../join/qr-scanner"
import {
  createCardRepeatFilter,
  pendingScans,
  refusedScans,
  type QueuedScan,
} from "./scan-queue"

/** What one scanned card came to; `queued` = no connection, it waits. */
export type ScanOutcome =
  | { kind: "marked"; person: CardLookup; line: string }
  | { kind: "already"; person: CardLookup }
  | { kind: "refused"; message: string }
  | { kind: "queued" }

// The server's own words for a foreign QR, so a code that is not a card at
// all is refused on the spot (and never queued offline).
export const NOT_A_CARD = "Это не карта участника ClubSpace"

const UNDO_MS = 5000

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

/**
 * The coach's card scanner for one session: a full-height camera that keeps
 * scanning. Each card is resolved and marked by `onScan` (the screen's
 * lookup + regular mark, or the offline queue); the strip under the camera
 * shows the latest person with «Отменить» for five seconds after a mark.
 */
export function ScanCardSheet({
  queue,
  sending,
  onScan,
  onUndo,
  onSendQueue,
  onDismissRefused,
  onClose,
}: {
  queue: readonly QueuedScan[]
  sending: boolean
  onScan: (card: string) => Promise<ScanOutcome>
  onUndo: (userId: string) => Promise<boolean>
  onSendQueue: () => void
  onDismissRefused: () => void
  onClose: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const [permission, requestPermission] = useCameraPermissions()
  const view = scannerView(permission)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [undoable, setUndoable] = useState(false)
  const [undoing, setUndoing] = useState(false)
  // One sighting per card while it stays in view (scan-queue).
  const isNewSighting = useRef(createCardRepeatFilter()).current
  const inFlight = useRef(new Set<string>())
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)

  // Ask right away the first time; the button below covers a dismissed prompt.
  const asked = useRef(false)
  useEffect(() => {
    if (view === "ask" && !asked.current) {
      asked.current = true
      void requestPermission()
    }
  }, [view, requestPermission])

  useEffect(
    () => () => {
      alive.current = false
      clearTimeout(undoTimer.current)
    },
    [],
  )

  const show = (next: ScanOutcome) => {
    if (!alive.current) return
    clearTimeout(undoTimer.current)
    setOutcome(next)
    setUndoable(next.kind === "marked")
    if (next.kind === "marked") {
      undoTimer.current = setTimeout(() => setUndoable(false), UNDO_MS)
    }
  }

  const handleScan = (data: string) => {
    // Every report slides the card's window, also while its answer is out.
    if (!isNewSighting(data) || inFlight.current.has(data)) return
    if (cardUserId(data) === null) {
      show({ kind: "refused", message: NOT_A_CARD })
      return
    }
    inFlight.current.add(data)
    void onScan(data)
      .then((next) => {
        if (next.kind === "marked") haptics.success()
        else if (next.kind === "refused") haptics.warning()
        show(next)
      })
      .finally(() => inFlight.current.delete(data))
  }

  const undo = async () => {
    if (outcome?.kind !== "marked" || undoing) return
    setUndoing(true)
    const ok = await onUndo(outcome.person.userId)
    if (!alive.current) return
    setUndoing(false)
    if (ok) {
      clearTimeout(undoTimer.current)
      setUndoable(false)
      setOutcome(null)
    }
  }

  const person =
    outcome?.kind === "marked" || outcome?.kind === "already" ? outcome.person : null
  const statusLine =
    outcome?.kind === "marked"
      ? outcome.line
      : outcome?.kind === "already"
        ? "Уже отмечен"
        : outcome?.kind === "refused"
          ? outcome.message
          : outcome?.kind === "queued"
            ? "Нет сети — карта отправится, когда появится связь"
            : null

  const closeButton = (
    <Pressable
      onPress={onClose}
      accessibilityRole="button"
      accessibilityLabel="Закрыть сканер"
      hitSlop={8}
      style={styles.close}
    >
      <Icon name="close" size={26} color={theme.colors.onOverlay} />
    </Pressable>
  )

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {view === "camera" ? (
        <View style={styles.cameraRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => handleScan(data)}
          />
          <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
            <View style={styles.topBar}>{closeButton}</View>
            <View style={styles.frame} />
            <View style={styles.panel}>
              {statusLine === null ? (
                <Text style={styles.hint}>
                  Наведите камеру на карту ученика в приложении
                </Text>
              ) : (
                <View style={styles.result} accessibilityLiveRegion="polite">
                  {person &&
                    (person.photoUrl ? (
                      <Image source={{ uri: person.photoUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarEmpty]}>
                        <Text style={styles.avatarText}>{initialsOf(person.name)}</Text>
                      </View>
                    ))}
                  <View style={styles.resultText}>
                    {person && (
                      <Text style={styles.name} numberOfLines={1}>
                        {person.name}
                        {person.inGroup === false ? " · гость" : ""}
                      </Text>
                    )}
                    <Text
                      style={[
                        styles.status,
                        outcome?.kind === "marked" && styles.statusOk,
                        outcome?.kind === "refused" && styles.statusRefused,
                      ]}
                    >
                      {statusLine}
                    </Text>
                  </View>
                  {undoable && (
                    <Pressable
                      onPress={() => void undo()}
                      disabled={undoing}
                      accessibilityRole="button"
                      hitSlop={8}
                      style={styles.undo}
                    >
                      {undoing ? (
                        <ActivityIndicator color={theme.colors.accent} />
                      ) : (
                        <Text style={styles.undoText}>Отменить</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              )}
              <ScanQueueNotice
                queue={queue}
                sending={sending}
                onSend={onSendQueue}
                onDismissRefused={onDismissRefused}
              />
            </View>
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <View style={[styles.topBar, styles.topBarPlain]}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть сканер"
              hitSlop={8}
              style={styles.close}
            >
              <Icon name="close" size={26} color={theme.colors.text} />
            </Pressable>
          </View>
          <View style={styles.center}>
            {view === "checking" ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <>
                <Text style={styles.title}>Нужен доступ к камере</Text>
                <Text style={styles.body}>
                  {view === "denied"
                    ? isWeb
                      ? `Доступ к камере запрещён. Разрешите его в настройках браузера или отмечайте учеников в списке ${vocabulary.session.gen}.`
                      : `Доступ к камере запрещён. Разрешите его в настройках или отмечайте учеников в списке ${vocabulary.session.gen}.`
                    : "Камера нужна, чтобы сканировать карты учеников."}
                </Text>
                {view === "ask" ? (
                  <Pressable
                    onPress={() => void requestPermission()}
                    accessibilityRole="button"
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>Разрешить доступ</Text>
                  </Pressable>
                ) : (
                  !isWeb && (
                    <Pressable
                      onPress={() => void Linking.openSettings()}
                      accessibilityRole="button"
                      style={styles.button}
                    >
                      <Text style={styles.buttonText}>Открыть настройки</Text>
                    </Pressable>
                  )
                )}
              </>
            )}
          </View>
        </SafeAreaView>
      )}
    </Modal>
  )
}

/**
 * Cards scanned with no connection: how many wait («Не отправлено: N ·
 * Отправить») and the ones the server refused when they were sent, with its
 * reason. Nothing when the queue is empty. Shown in the scanner and on the
 * roster, where the queue drains on focus.
 */
export function ScanQueueNotice({
  queue,
  sending,
  onSend,
  onDismissRefused,
}: {
  queue: readonly QueuedScan[]
  sending: boolean
  onSend: () => void
  onDismissRefused: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const pending = pendingScans(queue).length
  const refused = refusedScans(queue)
  if (pending === 0 && refused.length === 0) return null
  return (
    <View style={styles.queue}>
      {pending > 0 && (
        <View style={styles.queueRow}>
          <Text style={styles.queueText}>Не отправлено: {pending}</Text>
          {sending ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <Pressable onPress={onSend} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.queueAction}>Отправить</Text>
            </Pressable>
          )}
        </View>
      )}
      {refused.length > 0 && (
        <>
          {refused.map((s) => (
            <Text key={s.card} style={styles.queueRefused}>
              Карта не отмечена: {s.error}
            </Text>
          ))}
          <Pressable
            onPress={onDismissRefused}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.queueDismiss}
          >
            <Text style={styles.queueAction}>Понятно</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    cameraRoot: { flex: 1, backgroundColor: theme.colors.playerBg },
    overlay: {
      flex: 1,
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: theme.spacing(4),
    },
    topBar: {
      alignSelf: "stretch",
      flexDirection: "row",
      justifyContent: "flex-end",
      // The camera overlay pads the sides already.
      paddingHorizontal: 0,
      paddingTop: theme.spacing(2),
    },
    topBarPlain: { paddingTop: theme.spacing(3), paddingHorizontal: theme.spacing(3) },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    frame: {
      width: 240,
      height: 240,
      borderWidth: 3,
      borderColor: theme.colors.onOverlay,
      borderRadius: theme.radius.lg,
    },
    // Full width on a phone, a readable column on a tablet.
    panel: {
      width: "100%",
      maxWidth: READABLE_WIDTH,
      gap: theme.spacing(3),
      marginBottom: theme.spacing(4),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
    },
    hint: { ...theme.typography.body, color: theme.colors.text, textAlign: "center" },
    result: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
    avatar: { width: 56, height: 56, borderRadius: 28 },
    avatarEmpty: {
      backgroundColor: theme.colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: theme.colors.accent, fontSize: 20, fontWeight: "700" },
    resultText: { flex: 1, gap: 2 },
    name: { ...theme.typography.bodyStrong, color: theme.colors.text, fontSize: 17 },
    status: { ...theme.typography.body, color: theme.colors.muted },
    statusOk: { color: theme.colors.accent, fontWeight: "600" },
    statusRefused: { color: theme.colors.danger, fontWeight: "600" },
    undo: {
      minHeight: 44,
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    undoText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    center: {
      flex: 1,
      justifyContent: "center",
      gap: theme.spacing(3),
      width: "100%",
      maxWidth: READABLE_WIDTH,
      alignSelf: "center",
      paddingHorizontal: theme.spacing(6),
    },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    body: { ...theme.typography.body, color: theme.colors.muted },
    button: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
      marginTop: theme.spacing(1),
    },
    buttonText: { color: theme.colors.accentText, fontWeight: "700", fontSize: 16 },
    queue: { gap: theme.spacing(1) },
    queueRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(2),
    },
    queueText: { color: theme.colors.text, fontSize: 14 },
    queueRefused: { color: theme.colors.danger, fontSize: 13, lineHeight: 18 },
    queueDismiss: { alignSelf: "flex-start" },
    queueAction: { color: theme.colors.accent, fontSize: 15, fontWeight: "600" },
  })
