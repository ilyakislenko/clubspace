import React, { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import type { Theme } from "../../shared/theme"
import type { BookmarkDrawing } from "../../shared/api/video-study"
import { DrawingThumb } from "./DrawingCanvas"
import {
  bookmarkOpenLabel,
  formatBookmarkTime,
  formatPosition,
} from "./format-position"
import type { SharedMoment } from "./moment-link"

type Timestamp = { id: string; positionSec: number; title: string }
// endSec set = a saved A–B segment; drawing = a sketch on its paused frame.
type Bookmark = {
  id: string
  positionSec: number
  endSec: number | null
  label: string
  note: string
  drawing: BookmarkDrawing | null
}
type BookmarkField = "label" | "note"

type Props = {
  timestamps?: Timestamp[]
  // Index into `timestamps` of the chapter playing now; -1 = none.
  currentChapter: number
  bookmarks: Bookmark[]
  note: string
  onSeek: (sec: number) => void
  // A bookmark's time: seek, loop a segment A–B, or pause on its drawing.
  onOpenBookmark: (bookmark: Bookmark) => void
  // «Поделиться моментом» on chapter and bookmark rows.
  onShareMoment: (moment: SharedMoment) => void
  onAddBookmark: () => void
  onRemoveBookmark: (id: string) => void
  onUpdateBookmark: (
    id: string,
    patch: Partial<Pick<Bookmark, BookmarkField>>,
  ) => void
  onNoteChange: (text: string) => void
  // The id of the just-added bookmark, so its name field opens for editing
  // immediately (otherwise a new bookmark reads as "Без названия").
  justAddedBookmarkId?: string | null
  // «В план» on chapters and bookmarks (omitted = no button).
  onAddChapterToPlan?: (index: number) => void
  onAddBookmarkToPlan?: (bookmarkId: string) => void
}

// The study tools shown below the player: chapters (read-only seek targets),
// personal bookmarks (add/seek/remove, each with its own name and note) and a
// free-text note for the whole video. None of these touch the video player
// instance directly — they call back into the screen.
export function VideoStudyTools({
  timestamps,
  currentChapter,
  bookmarks,
  note,
  onSeek,
  onOpenBookmark,
  onShareMoment,
  onAddBookmark,
  onRemoveBookmark,
  onUpdateBookmark,
  onNoteChange,
  justAddedBookmarkId,
  onAddChapterToPlan,
  onAddBookmarkToPlan,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const [editing, setEditing] = useState<{
    id: string
    field: BookmarkField
  } | null>(null)
  const [draft, setDraft] = useState("")

  // Open the name field for a freshly-added bookmark so the user can name it
  // right away.
  useEffect(() => {
    if (justAddedBookmarkId) {
      setEditing({ id: justAddedBookmarkId, field: "label" })
      setDraft("")
    }
  }, [justAddedBookmarkId])

  const startEditing = (id: string, field: BookmarkField, current: string) => {
    setEditing({ id, field })
    setDraft(current)
  }
  // Saved on every keystroke, like the video note: Android keeps the field
  // focused when the keyboard is hidden with Back, so a blur-only save would
  // lose the text when the member then leaves the lesson.
  const changeDraft = (text: string) => {
    setDraft(text)
    if (editing) onUpdateBookmark(editing.id, { [editing.field]: text })
  }
  const commitEditing = () => {
    if (!editing) return
    onUpdateBookmark(editing.id, { [editing.field]: draft.trim() })
    setEditing(null)
  }

  return (
    <>
      {timestamps && timestamps.length > 0 && (
        <View style={styles.bookmarksBlock}>
          <Text style={styles.noteLabel}>Главы</Text>
          <View style={styles.bookmarkList}>
            {timestamps.map((ts, i) => {
              const current = i === currentChapter
              return (
                <Pressable
                  key={ts.id}
                  onPress={() => onSeek(ts.positionSec)}
                  accessibilityState={current ? { selected: true } : undefined}
                  style={[styles.bookmarkRow, current && styles.chapterCurrent]}
                >
                  <View style={styles.bookmarkTime}>
                    <Text style={styles.bookmarkTimeText}>
                      {formatPosition(ts.positionSec)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.bookmarkLabel, current && styles.chapterCurrentText]}
                    numberOfLines={1}
                  >
                    {ts.title}
                  </Text>
                  <Pressable
                    onPress={() => onShareMoment({ startSec: ts.positionSec, label: ts.title })}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Поделиться главой ${ts.title}`}
                    style={styles.share}
                  >
                    <Icon name="share-outline" size={18} color={theme.colors.muted} />
                  </Pressable>
                  {onAddChapterToPlan && (
                    <Pressable
                      onPress={() => onAddChapterToPlan(i)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Добавить главу ${ts.title} в план`}
                      style={styles.addToPlan}
                    >
                      <Text style={styles.addToPlanText}>В план</Text>
                    </Pressable>
                  )}
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      <View style={styles.bookmarksBlock}>
        <View style={styles.bookmarksHeader}>
          <Text style={styles.noteLabel}>Закладки</Text>
          <Pressable
            onPress={onAddBookmark}
            accessibilityRole="button"
            accessibilityLabel="Добавить закладку на текущем месте"
            style={styles.addBookmarkButton}
          >
            <Text style={styles.addBookmarkText}>+ Добавить</Text>
          </Pressable>
        </View>
        {bookmarks.length === 0 ? (
          <Text style={styles.muted}>
            Нажмите «Добавить» в нужный момент — вернётесь сюда одним тапом.
          </Text>
        ) : (
          <View style={styles.bookmarkList}>
            {bookmarks.map((b) => (
              <View key={b.id} style={styles.bookmarkCard}>
                <View style={styles.bookmarkHead}>
                  <Pressable
                    onPress={() => onOpenBookmark(b)}
                    accessibilityRole="button"
                    accessibilityLabel={bookmarkOpenLabel(b)}
                    style={styles.bookmarkTime}
                  >
                    <Text style={styles.bookmarkTimeText}>
                      {formatBookmarkTime(b)}
                      {b.drawing ? " ✎" : ""}
                    </Text>
                  </Pressable>
                  {b.drawing && (
                    <Pressable
                      onPress={() => onOpenBookmark(b)}
                      accessibilityRole="none"
                    >
                      <DrawingThumb strokes={b.drawing.strokes} />
                    </Pressable>
                  )}
                  {editing?.id === b.id && editing.field === "label" ? (
                    <TextInput
                      value={draft}
                      onChangeText={changeDraft}
                      onSubmitEditing={commitEditing}
                      onBlur={commitEditing}
                      placeholder="Название закладки"
                      placeholderTextColor={theme.colors.mutedFaint}
                      autoFocus
                      returnKeyType="done"
                      style={styles.bookmarkLabelInput}
                    />
                  ) : (
                    <Pressable
                      onPress={() => startEditing(b.id, "label", b.label)}
                      style={styles.bookmarkLabelPress}
                      accessibilityRole="button"
                      accessibilityLabel={
                        b.label ? `Закладка ${b.label}, переименовать` : "Назвать закладку"
                      }
                    >
                      <Text
                        style={b.label ? styles.bookmarkLabel : styles.bookmarkLabelEmpty}
                        numberOfLines={1}
                      >
                        {b.label || "Назвать…"}
                      </Text>
                    </Pressable>
                  )}
                  {onAddBookmarkToPlan && (
                    <Pressable
                      onPress={() => onAddBookmarkToPlan(b.id)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Добавить закладку в план"
                      style={styles.addToPlan}
                    >
                      <Text style={styles.addToPlanText}>В план</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() =>
                      onShareMoment({ startSec: b.positionSec, endSec: b.endSec, label: b.label })
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Поделиться закладкой"
                    style={styles.share}
                  >
                    <Icon name="share-outline" size={18} color={theme.colors.muted} />
                  </Pressable>
                  <Pressable
                    onPress={() => onRemoveBookmark(b.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Удалить закладку"
                    style={styles.bookmarkRemove}
                  >
                    <Text style={styles.bookmarkRemoveText}>✕</Text>
                  </Pressable>
                </View>
                {editing?.id === b.id && editing.field === "note" ? (
                  <TextInput
                    value={draft}
                    onChangeText={changeDraft}
                    onBlur={commitEditing}
                    placeholder="Что важно в этом моменте"
                    placeholderTextColor={theme.colors.mutedFaint}
                    autoFocus
                    multiline
                    textAlignVertical="top"
                    style={styles.bookmarkNoteInput}
                  />
                ) : (
                  <Pressable
                    onPress={() => startEditing(b.id, "note", b.note)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      b.note ? "Изменить заметку к закладке" : "Добавить заметку к закладке"
                    }
                  >
                    <Text style={b.note ? styles.bookmarkNote : styles.bookmarkNoteAdd}>
                      {b.note || "+ Заметка"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.noteBlock}>
        <Text style={styles.noteLabel}>Личные заметки</Text>
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder={`Например: попробовал на ${vocabulary.session.prep}, получается не с первого раза`}
          placeholderTextColor={theme.colors.muted}
          multiline
          style={styles.noteInput}
          textAlignVertical="top"
        />
      </View>
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  bookmarksBlock: { gap: theme.spacing(2) },
  bookmarksHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addBookmarkButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  addBookmarkText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.text,
  },
  bookmarkList: { gap: theme.spacing(1) + 2 },
  bookmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(1) + 2,
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceMuted,
  },
  // The chapter playing now.
  chapterCurrent: { backgroundColor: theme.colors.accentSoft },
  chapterCurrentText: { fontWeight: "700" },
  bookmarkCard: {
    gap: theme.spacing(1),
    paddingVertical: theme.spacing(1) + 2,
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceMuted,
  },
  bookmarkHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  bookmarkTime: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bookmarkTimeText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.accent,
    fontVariant: ["tabular-nums"],
  },
  bookmarkLabel: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
  },
  bookmarkLabelPress: { flex: 1 },
  bookmarkLabelEmpty: {
    flex: 1,
    fontSize: 13,
    fontStyle: "italic",
    color: theme.colors.mutedFaint,
  },
  bookmarkLabelInput: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
    paddingVertical: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accent,
  },
  share: { paddingHorizontal: theme.spacing(1), paddingVertical: 2 },
  bookmarkRemove: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
  },
  bookmarkRemoveText: {
    fontSize: 16,
    color: theme.colors.muted,
  },
  bookmarkNote: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.text,
  },
  bookmarkNoteAdd: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  bookmarkNoteInput: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.text,
    minHeight: 56,
    maxHeight: 140,
    padding: theme.spacing(2),
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  noteBlock: { gap: theme.spacing(2) },
  noteLabel: { ...theme.typography.label },
  muted: { ...theme.typography.caption },
  noteInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing(3),
    minHeight: 84,
    // Grows to ~6 lines, then scrolls inside, so the caret never slips under
    // the keyboard on a short (landscape) screen.
    maxHeight: 160,
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
    lineHeight: 20,
  },
  addToPlan: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  addToPlanText: { fontSize: 12, fontWeight: "600", color: theme.colors.accent },
})
