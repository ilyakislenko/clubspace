import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native"

import type { ReviewDrawing } from "../../shared/api/video-reviews"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { DrawingThumb } from "../video/DrawingCanvas"
import { formatPosition } from "../video/format-position"

export type CommentDraft = {
  // Set when editing an existing comment.
  commentId?: string
  atSec: number
  text: string
  drawing: ReviewDrawing | null
}

type Props = {
  draft: CommentDraft
  // Throws to keep the sheet open with the error.
  onSave: (draft: CommentDraft) => Promise<void>
  // «Рисунок»: the sheet closes while the coach draws on the frame.
  onDraw: (draft: CommentDraft) => void
  onClose: () => void
}

// A coach's comment at a moment of the clip: the text, and optionally a
// drawing over that frame.
export function ReviewCommentModal({ draft, onSave, onDraw, onClose }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [text, setText] = useState(draft.text)
  const [drawing, setDrawing] = useState(draft.drawing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<TextInputInstance>(null)

  // Same as EditNameModal: focusing once the modal settled opens the
  // Android keyboard (`autoFocus` alone doesn't).
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [])

  const current = (): CommentDraft => ({ ...draft, text, drawing })
  const canSave = text.trim().length > 0

  const save = async () => {
    if (saving || !canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...current(), text: text.trim() })
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить комментарий."))
      setSaving(false)
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          onAccessibilityEscape={onClose}
          accessibilityRole="none"
        >
          <Pressable
            style={styles.sheet}
            accessibilityRole="none"
            onPress={() => {
              /* swallow, so a tap inside the sheet doesn't dismiss it */
            }}
          >
            <Text style={styles.title}>
              {draft.commentId ? "Комментарий" : "Комментарий здесь"} ·{" "}
              {formatPosition(draft.atSec)}
            </Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Что поправить в этом моменте"
              placeholderTextColor={theme.colors.muted}
              multiline
              textAlignVertical="top"
              maxLength={2000}
            />
            <View style={styles.drawingRow}>
              {drawing && <DrawingThumb strokes={drawing.strokes} />}
              <Pressable
                onPress={() => onDraw(current())}
                accessibilityRole="button"
                style={styles.chip}
              >
                <Text style={styles.chipText}>
                  {drawing ? "✎ Изменить рисунок" : "✎ Нарисовать на кадре"}
                </Text>
              </Pressable>
              {drawing && (
                <Pressable
                  onPress={() => setDrawing(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Убрать рисунок"
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>✕</Text>
                </Pressable>
              )}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={[styles.button, styles.buttonSecondary]}
              >
                <Text style={styles.buttonSecondaryText}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={() => void save()}
                disabled={saving || !canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || !canSave }}
                style={[styles.button, styles.buttonPrimary, !canSave && styles.disabled]}
              >
                {saving ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonPrimaryText}>Сохранить</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      maxWidth: 480,
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      padding: theme.spacing(5),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    title: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
    input: {
      minHeight: 96,
      maxHeight: 200,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing(3),
      fontSize: 15,
      color: theme.colors.text,
    },
    drawingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    chipText: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
    error: { color: theme.colors.danger, fontSize: 13 },
    actions: { flexDirection: "row", gap: theme.spacing(2), marginTop: theme.spacing(1) },
    button: {
      flex: 1,
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonSecondaryText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonPrimaryText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    disabled: { opacity: 0.5 },
  })
