import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import * as ImagePicker from "expo-image-picker"
import React, { useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  completeMyVideoReviewUpload,
  createMyVideoReview,
  deleteMyVideoReview,
} from "../../shared/api/video-reviews"
import { useAuth } from "../../shared/auth-context"
import { invalidateResource } from "../../shared/cache/cache-events"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { uploadFileWithProgress } from "../../shared/upload-file"
import { useVocabulary } from "../../shared/use-vocabulary"
import { formatPosition } from "../video/format-position"
import {
  pickedClipProblem,
  REVIEWS_RESOURCE,
  titleFromFileName,
  uploadPercent,
} from "./review-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "NewVideoReview">

type Picked = {
  uri: string
  fileName: string | null
  fileSize: number
  durationSec: number | null
  mimeType: string
}

// «Отправить видео на разбор»: pick a clip from the gallery, name it, say
// what to look at, and upload it (with progress). The coaches are told once
// the upload is complete.
export function NewVideoReviewScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const { workspace } = useAuth()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const pick = async () => {
    setError(null)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      allowsMultipleSelection: false,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    const problem = pickedClipProblem({
      fileSize: asset.fileSize,
      duration: asset.duration,
      mimeType: asset.mimeType,
    })
    if (problem) {
      setError(problem)
      return
    }
    setPicked({
      uri: asset.uri,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize!,
      durationSec: asset.duration != null ? asset.duration / 1000 : null,
      mimeType: asset.mimeType ?? "video/mp4",
    })
    if (!title.trim()) setTitle(titleFromFileName(asset.fileName))
  }

  const send = async () => {
    if (!workspace || !picked || progress !== null) return
    const workspaceId = workspace.workspaceId
    setError(null)
    setProgress(0)
    let requestId: string | null = null
    try {
      const created = await createMyVideoReview({
        workspaceId,
        data: {
          title: title.trim(),
          message: message.trim() || null,
          contentType: picked.mimeType,
          sizeBytes: picked.fileSize,
          ...(picked.durationSec != null && { durationSec: picked.durationSec }),
        },
      })
      requestId = created.request.id
      await uploadFileWithProgress({
        url: created.upload.url,
        fileUri: picked.uri,
        contentType: picked.mimeType,
        onProgress: (sent, total) => setProgress(uploadPercent(sent, total || picked.fileSize)),
      })
      await completeMyVideoReviewUpload({ workspaceId, requestId })
      invalidateResource(REVIEWS_RESOURCE, workspaceId)
      navigation.replace("VideoReview", { requestId, title: created.request.title })
    } catch (err) {
      // A request whose file never arrived is no use to anyone: remove it, so
      // a retry starts clean instead of leaving a stuck «загружается».
      if (requestId) {
        void deleteMyVideoReview({ workspaceId, requestId }).catch(() => undefined)
      }
      setError(errorMessage(err, "Не удалось отправить видео. Попробуйте ещё раз."))
      setProgress(null)
    }
  }

  const sending = progress !== null
  const canSend = !!picked && title.trim().length > 0 && !sending

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Видео до 10 минут и 500 МБ. Его увидите только вы и{" "}
            {vocabulary.coach.nomPl} клуба — в курсы и общий доступ оно не попадает.
          </Text>

          <Pressable
            onPress={() => void pick()}
            disabled={sending}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
          >
            <Text style={styles.pickTitle}>
              {picked ? "Выбрать другое видео" : "Выбрать видео из галереи"}
            </Text>
            {picked && (
              <Text style={styles.muted} numberOfLines={1}>
                {[
                  picked.fileName,
                  picked.durationSec != null ? formatPosition(picked.durationSec) : null,
                  `${Math.round(picked.fileSize / 1024 / 1024)} МБ`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.label}>Название</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Например: новая техника, вторая попытка"
              placeholderTextColor={theme.colors.muted}
              maxLength={200}
              editable={!sending}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>На что посмотреть</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Что получается, что нет, о чём спросить"
              placeholderTextColor={theme.colors.muted}
              multiline
              textAlignVertical="top"
              maxLength={2000}
              editable={!sending}
              style={[styles.input, styles.multiline]}
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {sending ? (
            <View style={styles.progress}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.muted}>
                {progress < 100 ? `Загрузка видео… ${progress} %` : "Почти готово…"}
              </Text>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          ) : (
            <Pressable
              onPress={() => void send()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => [
                styles.send,
                !canSend && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.sendText}>Отправить на разбор</Text>
            </Pressable>
          )}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    hint: { ...theme.typography.body, color: theme.colors.muted },
    pick: {
      gap: theme.spacing(1),
      padding: theme.spacing(5),
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
      alignItems: "center",
    },
    pickTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.accent },
    muted: { fontSize: 13, color: theme.colors.muted },
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
    multiline: { minHeight: 96, maxHeight: 200 },
    error: { color: theme.colors.danger, fontSize: 14 },
    progress: { gap: theme.spacing(2), alignItems: "stretch" },
    progressBar: {
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.surfaceMuted,
      overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: theme.colors.accent },
    send: {
      alignItems: "center",
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    sendText: { color: theme.colors.accentText, fontSize: 16, fontWeight: "700" },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
  })
