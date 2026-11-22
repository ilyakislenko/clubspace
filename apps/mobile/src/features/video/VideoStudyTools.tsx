import React, { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { BookmarkDrawing } from "../../shared/api/video-study"
import {
  bookmarkOpenLabel,
  formatBookmarkTime,
  formatPosition,
} from "./format-position"
import { MoreButton } from "./MenuOption"
import type { SharedMoment } from "./moment-link"
import { MomentMenuSheet } from "./MomentMenuSheet"

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
  // A bookmark's tap: seek, loop a segment A–B, or pause on its drawing.
  onOpenBookmark: (bookmark: Bookmark) => void
  // «Поделиться моментом» in a chapter's or bookmark's menu.
  onShareMoment: (moment: SharedMoment) => void
  onAddBookmark: () => void
  onRemoveBookmark: (id: string) => void
  onUpdateBookmark: (
    id: string,
    patch: Partial<Pick<Bookmark, BookmarkField>>,
  ) => void
  onNoteChange: (text: string) => void
  // The id of the just-added bookmark, so its name field opens for editing
  // immediately (otherwise a new bookmark reads as just its time).
  justAddedBookmarkId?: string | null
  // «В план» in a chapter's or bookmark's menu (omitted = not offered).
  onAddChapterToPlan?: (index: number) => void
  onAddBookmarkToPlan?: (bookmarkId: string) => void
}

// The study tools below the player: chapters (seek targets, shown from two
// on — the seek bar's ticks carry a lone one), personal bookmarks (tap to
// open, «⋯» for the rest) and a note for the whole lesson, opened on demand.
// None of these touch the player — they call back into the screen.
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
  // A bookmark's name or note being typed, in place.
  const [editing, setEditing] = useState<{
    id: string
    field: BookmarkField
  } | null>(null)
  const [draft, setDraft] = useState("")
  const [editingNote, setEditingNote] = useState(false)
  // The row whose «⋯» menu is open.
  const [menu, setMenu] = useState<
    { kind: "chapter"; index: number } | { kind: "bookmark"; id: string } | null
  >(null)

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
  // Saved on every keystroke, like the lesson note: Android keeps the field
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

  const chapters = timestamps && timestamps.length >= 2 ? timestamps : null
  const menuChapter = menu?.kind === "chapter" ? chapters?.[menu.index] : undefined
  const menuBookmark =
    menu?.kind === "bookmark" ? bookmarks.find((b) => b.id === menu.id) : undefined

  const addBookmark = (
    <Pressable
      onPress={onAddBookmark}
      accessibilityRole="button"
      accessibilityLabel="Добавить закладку на текущем месте"
      style={styles.addRow}
    >
      <Icon name="add" size={18} color={theme.colors.accent} />
      <Text style={styles.addText}>Закладка</Text>
    </Pressable>
  )

  return (
    <>
      {chapters && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Главы</Text>
          <View>
            {chapters.map((ts, i) => {
              const current = i === currentChapter
              const openMenu = () => setMenu({ kind: "chapter", index: i })
              return (
                <View key={ts.id} style={[styles.row, current && styles.rowCurrent]}>
                  <Pressable
                    onPress={() => onSeek(ts.positionSec)}
                    onLongPress={openMenu}
                    accessibilityLabel={`Глава ${ts.title}, ${formatPosition(ts.positionSec)}`}
                    accessibilityState={current ? { selected: true } : undefined}
                    style={styles.rowMain}
                  >
                    <Text style={styles.time}>{formatPosition(ts.positionSec)}</Text>
                    <Text
                      style={[styles.rowTitle, current && styles.rowTitleCurrent]}
                      numberOfLines={1}
                    >
                      {ts.title}
                    </Text>
                  </Pressable>
                  <MoreButton onPress={openMenu} hint={`Глава ${ts.title}`} />
                </View>
              )
            })}
          </View>
        </View>
      )}

      {bookmarks.length === 0 ? (
        addBookmark
      ) : (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Закладки</Text>
            {addBookmark}
          </View>
          <View>
            {bookmarks.map((b) => {
              const editingLabel = editing?.id === b.id && editing.field === "label"
              const editingBookmarkNote = editing?.id === b.id && editing.field === "note"
              return (
                <View key={b.id} style={styles.bookmark}>
                  {editingLabel ? (
                    <View style={styles.row}>
                      <View style={styles.rowMain}>
                        <Text style={styles.time}>{formatBookmarkTime(b)}</Text>
                        <TextInput
                          value={draft}
                          onChangeText={changeDraft}
                          onSubmitEditing={commitEditing}
                          onBlur={commitEditing}
                          placeholder="Название закладки"
                          placeholderTextColor={theme.colors.mutedFaint}
                          autoFocus
                          returnKeyType="done"
                          style={styles.labelInput}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.row}>
                      <Pressable
                        onPress={() => onOpenBookmark(b)}
                        onLongPress={() => setMenu({ kind: "bookmark", id: b.id })}
                        accessibilityLabel={bookmarkOpenLabel(b)}
                        style={styles.rowMain}
                      >
                        <Text style={styles.time}>{formatBookmarkTime(b)}</Text>
                        <View style={styles.rowText}>
                          <View style={styles.labelLine}>
                            {b.label ? (
                              <Text style={styles.rowTitle} numberOfLines={1}>
                                {b.label}
                              </Text>
                            ) : null}
                            {b.drawing && (
                              <Icon
                                name="brush-outline"
                                size={14}
                                color={theme.colors.muted}
                              />
                            )}
                          </View>
                          {b.note && !editingBookmarkNote ? (
                            <Text style={styles.notePreview} numberOfLines={1}>
                              {b.note}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                      <MoreButton
                        onPress={() => setMenu({ kind: "bookmark", id: b.id })}
                        hint={`Закладка ${b.label || formatBookmarkTime(b)}`}
                      />
                    </View>
                  )}
                  {editingBookmarkNote && (
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
                  )}
                </View>
              )
            })}
          </View>
        </View>
      )}

      {editingNote ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Заметка</Text>
          <TextInput
            value={note}
            onChangeText={onNoteChange}
            onBlur={() => setEditingNote(false)}
            placeholder="Заметка к уроку"
            placeholderTextColor={theme.colors.muted}
            autoFocus
            multiline
            style={styles.noteInput}
            textAlignVertical="top"
          />
        </View>
      ) : note ? (
        <Pressable
          onPress={() => setEditingNote(true)}
          accessibilityRole="button"
          accessibilityLabel="Заметка к уроку, изменить"
          style={styles.section}
        >
          <Text style={styles.sectionTitle}>Заметка</Text>
          <Text style={styles.noteText}>{note}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setEditingNote(true)}
          accessibilityRole="button"
          accessibilityLabel="Добавить заметку к уроку"
          style={styles.addRow}
        >
          <Icon name="add" size={18} color={theme.colors.accent} />
          <Text style={styles.addText}>Заметка</Text>
        </Pressable>
      )}

      {menu?.kind === "chapter" && menuChapter && (
        <MomentMenuSheet
          title={menuChapter.title}
          onClose={() => setMenu(null)}
          onAddToPlan={
            onAddChapterToPlan ? () => onAddChapterToPlan(menu.index) : undefined
          }
          onShare={() =>
            onShareMoment({ startSec: menuChapter.positionSec, label: menuChapter.title })
          }
        />
      )}
      {menuBookmark && (
        <MomentMenuSheet
          title={menuBookmark.label || formatBookmarkTime(menuBookmark)}
          onClose={() => setMenu(null)}
          onRename={() => startEditing(menuBookmark.id, "label", menuBookmark.label)}
          onEditNote={() => startEditing(menuBookmark.id, "note", menuBookmark.note)}
          hasNote={!!menuBookmark.note}
          onAddToPlan={
            onAddBookmarkToPlan ? () => onAddBookmarkToPlan(menuBookmark.id) : undefined
          }
          onShare={() =>
            onShareMoment({
              startSec: menuBookmark.positionSec,
              endSec: menuBookmark.endSec,
              label: menuBookmark.label,
            })
          }
          onRemove={() => onRemoveBookmark(menuBookmark.id)}
        />
      )}
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  section: { gap: theme.spacing(1) },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { ...theme.typography.bodyStrong, color: theme.colors.text },
  // «+ Закладка», «+ Заметка»: quiet text actions.
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing(1),
    minHeight: 44,
  },
  addText: { fontSize: 15, fontWeight: "600", color: theme.colors.accent },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.radius.md,
  },
  // The chapter playing now.
  rowCurrent: { backgroundColor: theme.colors.accentSoft },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    minHeight: 44,
    paddingVertical: theme.spacing(1),
    paddingLeft: theme.spacing(2),
  },
  rowText: { flex: 1, gap: 2 },
  labelLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  time: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.accent,
    fontVariant: ["tabular-nums"],
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: 15,
    color: theme.colors.text,
  },
  rowTitleCurrent: { fontWeight: "700" },
  notePreview: { ...theme.typography.caption },
  bookmark: { gap: theme.spacing(1) },
  labelInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.text,
    paddingVertical: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accent,
  },
  bookmarkNoteInput: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.text,
    minHeight: 56,
    maxHeight: 140,
    padding: theme.spacing(2),
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  noteText: { ...theme.typography.body, color: theme.colors.text },
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
})
