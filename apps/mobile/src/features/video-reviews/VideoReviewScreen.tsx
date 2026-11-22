import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { showAlert } from "../../shared/alert"
import {
  addVideoReviewComment,
  deleteMyVideoReview,
  deleteVideoReviewComment,
  getVideoReview,
  getVideoReviewPlayback,
  setVideoReviewStatus,
  updateVideoReviewComment,
  type VideoReview,
  type VideoReviewComment,
} from "../../shared/api/video-reviews"
import { useAuth } from "../../shared/auth-context"
import { invalidateResource } from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { DrawingThumb } from "../video/DrawingCanvas"
import { formatBookmarkTime } from "../video/format-position"
import type { PlayerHandle } from "../video/player-types"
import {
  activeCommentId,
  isPlayable,
  reviewCacheKey,
  REVIEWS_RESOURCE,
  reviewStatusLabel,
} from "./review-helpers"
import { type CommentDraft, ReviewCommentModal } from "./ReviewCommentModal"
import { type CommentFocus, ReviewPlayer } from "./ReviewPlayer"

type Props = NativeStackScreenProps<RootStackParamList, "VideoReview">

// While the clip is being transcoded the request is re-read this often.
const PROCESSING_POLL_MS = 8_000
const TIME_POLL_MS = 500

// One «Разбор видео»: the member's clip with the coach's comments as marks.
// The member reads (and closes or deletes their request); staff comment at
// the current moment — text and an optional drawing on the frame — and mark
// it answered. Online only (the clip streams).
export function VideoReviewScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const { requestId } = route.params
  const workspaceId = workspace?.workspaceId ?? null
  const resource = useCachedResource(
    workspaceId ? reviewCacheKey(workspaceId, requestId) : null,
    useCallback(
      async () => await getVideoReview({ workspaceId: workspaceId!, requestId }),
      [workspaceId, requestId],
    ),
  )
  const review = resource.data
  const [hlsUrl, setHlsUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [focus, setFocus] = useState<CommentFocus | null>(null)
  const [draft, setDraft] = useState<CommentDraft | null>(null)
  // The draft whose drawing is being made on the frame (the sheet is closed).
  const [drawingFor, setDrawingFor] = useState<CommentDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [time, setTime] = useState(0)
  const playerRef = useRef<PlayerHandle | null>(null)
  const onPlayer = useCallback((p: PlayerHandle) => {
    playerRef.current = p
  }, [])

  useEffect(() => {
    if (review) navigation.setOptions({ title: review.title })
  }, [navigation, review])

  const playable = !!review && isPlayable(review.status)
  useEffect(() => {
    if (!playable || hlsUrl || !workspaceId) return
    let cancelled = false
    getVideoReviewPlayback({ workspaceId, requestId })
      .then((res) => !cancelled && setHlsUrl(res.hlsUrl))
      .catch((err: unknown) => {
        if (!cancelled) setPlaybackError(errorMessage(err, "Не удалось открыть видео."))
      })
    return () => {
      cancelled = true
    }
  }, [playable, hlsUrl, workspaceId, requestId])

  // Uploaded but not transcoded yet: look again until it is.
  const { refetch } = resource
  useFocusEffect(
    useCallback(() => {
      if (!review || playable || review.status === "failed") return
      const id = setInterval(refetch, PROCESSING_POLL_MS)
      return () => clearInterval(id)
    }, [review, playable, refetch]),
  )

  useEffect(() => {
    const id = setInterval(() => {
      const t = playerRef.current?.currentTime
      if (typeof t === "number") setTime(t)
    }, TIME_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const changed = async (updated: VideoReview | null) => {
    if (updated) resource.mutate(updated)
    if (workspaceId) invalidateResource(REVIEWS_RESOURCE, workspaceId)
  }

  const run = async (fn: () => Promise<VideoReview | null>, failure: string) => {
    if (busy) return
    setBusy(true)
    try {
      await changed(await fn())
    } catch (err) {
      showToast(errorMessage(err, failure), "error")
    } finally {
      setBusy(false)
    }
  }

  const openComment = (c: VideoReviewComment) =>
    setFocus((prev) => ({ commentId: c.id, nonce: (prev?.nonce ?? 0) + 1 }))

  const commentHere = () => {
    const player = playerRef.current
    player?.pause()
    setDraft({ atSec: Math.floor(player?.currentTime ?? time), text: "", drawing: null })
  }

  const saveDraft = async (d: CommentDraft) => {
    if (!workspaceId) return
    const data = { atSec: d.atSec, text: d.text, drawing: d.drawing }
    const updated = d.commentId
      ? await updateVideoReviewComment({ workspaceId, requestId, commentId: d.commentId, data })
      : await addVideoReviewComment({ workspaceId, requestId, data })
    await changed(updated)
    setDraft(null)
  }

  const startDrawing = (d: CommentDraft) => {
    const player = playerRef.current
    if (player) {
      player.pause()
      player.currentTime = d.atSec
    }
    setDraft(null)
    setDrawingFor(d)
  }

  const removeComment = (c: VideoReviewComment) =>
    showAlert("Удалить комментарий?", c.text, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          void run(
            () =>
              deleteVideoReviewComment({ workspaceId: workspaceId!, requestId, commentId: c.id }),
            "Не удалось удалить комментарий.",
          ),
      },
    ])

  const setStatus = (status: "open" | "answered" | "closed", done: string) =>
    void run(async () => {
      await setVideoReviewStatus({ workspaceId: workspaceId!, requestId, status })
      showToast(done, "success")
      return await getVideoReview({ workspaceId: workspaceId!, requestId })
    }, "Не удалось изменить статус.")

  const removeRequest = () =>
    showAlert("Удалить разбор?", "Видео и все комментарии к нему удалятся.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMyVideoReview({ workspaceId: workspaceId!, requestId })
            if (workspaceId) invalidateResource(REVIEWS_RESOURCE, workspaceId)
            showToast("Разбор удалён")
            navigation.goBack()
          } catch (err) {
            showToast(errorMessage(err, "Не удалось удалить разбор."), "error")
          }
        },
      },
    ])

  if (!review) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom"]}>
        {resource.error ? (
          <ErrorRetry message={resource.error} onRetry={resource.refetch} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
      </SafeAreaView>
    )
  }

  const staff = review.viewerIsStaff
  const owner = review.viewerIsOwner
  const active = activeCommentId(review.comments, time)

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={resource.refreshing}
              onRefresh={resource.refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {resource.stale && (
            <OfflineNotice message="Нет сети — разбор откроется, когда появится интернет" />
          )}

          {playable ? (
            playbackError ? (
              <ErrorRetry
                message={playbackError}
                onRetry={() => {
                  setPlaybackError(null)
                  setHlsUrl(null)
                }}
              />
            ) : (
              <ReviewPlayer
                uri={hlsUrl}
                comments={review.comments}
                focus={focus}
                editing={
                  drawingFor
                    ? {
                        initialStrokes: drawingFor.drawing?.strokes ?? [],
                        onSave: (drawing) => {
                          setDraft({ ...drawingFor, drawing })
                          setDrawingFor(null)
                        },
                        onCancel: () => {
                          setDraft(drawingFor)
                          setDrawingFor(null)
                        },
                      }
                    : null
                }
                onPlayer={onPlayer}
              />
            )
          ) : (
            <View style={styles.pending}>
              {review.status === "failed" ? (
                <Text style={styles.pendingText}>
                  {review.clip.errorMessage ?? "Не удалось обработать видео."}
                </Text>
              ) : (
                <>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={styles.pendingText}>
                    Видео обрабатывается — обычно это пара минут.
                  </Text>
                </>
              )}
            </View>
          )}

          <View style={styles.head}>
            <View style={styles.statusChip}>
              <Text style={styles.statusText}>
                {reviewStatusLabel(review.status, vocabulary)}
              </Text>
            </View>
            {!owner && <Text style={styles.muted}>{review.member.name}</Text>}
          </View>
          {review.message ? <Text style={styles.message}>{review.message}</Text> : null}

          <View style={styles.actions}>
            {staff && playable && (
              <ActionButton
                primary
                label={`+ Комментарий здесь · ${formatBookmarkTime({ positionSec: time, endSec: null })}`}
                onPress={commentHere}
                disabled={busy || !hlsUrl}
              />
            )}
            {staff && review.status === "open" && (
              <ActionButton
                label="Отметить отвечённым"
                onPress={() => setStatus("answered", "Разбор отмечен отвеченным")}
                disabled={busy}
              />
            )}
            {(staff || owner) && playable && review.status !== "closed" && (
              <ActionButton
                label="Закрыть разбор"
                onPress={() => setStatus("closed", "Разбор закрыт")}
                disabled={busy}
              />
            )}
            {(staff || owner) && review.status === "closed" && (
              <ActionButton
                label="Открыть снова"
                onPress={() => setStatus("open", "Разбор снова открыт")}
                disabled={busy}
              />
            )}
            {owner && (
              <ActionButton label="Удалить разбор" onPress={removeRequest} disabled={busy} />
            )}
          </View>

          <Text style={styles.sectionTitle}>Комментарии</Text>
          {review.comments.length === 0 ? (
            <Text style={styles.muted}>
              {staff
                ? "Поставьте видео на нужный момент и нажмите «Комментарий здесь»."
                : `Пока нет комментариев — ${vocabulary.coach.nom} ответит здесь.`}
            </Text>
          ) : (
            review.comments.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => openComment(c)}
                accessibilityRole="button"
                accessibilityLabel={`${formatBookmarkTime({ positionSec: c.atSec, endSec: c.endSec })}: ${c.text}`}
                style={({ pressed }) => [
                  styles.comment,
                  c.id === active && styles.commentActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.commentHead}>
                  <View style={styles.timeChip}>
                    <Text style={styles.timeText}>
                      {formatBookmarkTime({ positionSec: c.atSec, endSec: c.endSec })}
                    </Text>
                  </View>
                  <Text style={styles.author} numberOfLines={1}>
                    {c.author.name}
                  </Text>
                  {c.drawing && <DrawingThumb strokes={c.drawing.strokes} />}
                </View>
                <Text style={styles.commentText}>{c.text}</Text>
                {staff && c.mine && (
                  <View style={styles.commentActions}>
                    <Pressable
                      onPress={() =>
                        setDraft({
                          commentId: c.id,
                          atSec: c.atSec,
                          text: c.text,
                          drawing: c.drawing,
                        })
                      }
                      accessibilityRole="button"
                      hitSlop={6}
                    >
                      <Text style={styles.link}>Изменить</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => removeComment(c)}
                      accessibilityRole="button"
                      hitSlop={6}
                    >
                      <Text style={styles.linkDanger}>Удалить</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            ))
          )}
        </ScrollView>
      </CenteredColumn>

      {draft && (
        <ReviewCommentModal
          draft={draft}
          onSave={saveDraft}
          onDraw={startDrawing}
          onClose={() => setDraft(null)}
        />
      )}
    </SafeAreaView>
  )
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  primary?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    body: { padding: theme.spacing(4), gap: theme.spacing(3) },
    pending: {
      aspectRatio: 16 / 9,
      maxHeight: 360,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(2),
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    pendingText: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
    head: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    statusChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
    },
    statusText: { fontSize: 12, fontWeight: "700", color: theme.colors.accent },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    message: { ...theme.typography.body, color: theme.colors.text },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
    action: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    actionPrimary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    actionText: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
    actionTextPrimary: { color: theme.colors.accentText },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
    sectionTitle: { ...theme.typography.label, marginTop: theme.spacing(2) },
    comment: {
      gap: theme.spacing(1),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    commentActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    commentHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    author: { flex: 1, fontSize: 13, color: theme.colors.muted },
    commentText: { ...theme.typography.body, color: theme.colors.text },
    commentActions: { flexDirection: "row", gap: theme.spacing(4), marginTop: theme.spacing(1) },
    link: { fontSize: 13, fontWeight: "600", color: theme.colors.accent },
    linkDanger: { fontSize: 13, fontWeight: "600", color: theme.colors.danger },
  })
