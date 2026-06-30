import React from "react"
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"

import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatPosition } from "./format-position"

type Timestamp = { id: string; positionSec: number; title: string }
type Bookmark = { id: string; position: number; label: string }

type Props = {
  timestamps?: Timestamp[]
  bookmarks: Bookmark[]
  note: string
  onSeek: (sec: number) => void
  onAddBookmark: () => void
  onRemoveBookmark: (id: string) => void
  onNoteChange: (text: string) => void
}

// The study tools shown below the player: chapters (read-only seek targets),
// personal bookmarks (add/seek/remove) and a free-text note. None of these
// touch the video player instance directly — they call back into the screen.
export function VideoStudyTools({
  timestamps,
  bookmarks,
  note,
  onSeek,
  onAddBookmark,
  onRemoveBookmark,
  onNoteChange,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <>
      {timestamps && timestamps.length > 0 && (
        <View style={styles.bookmarksBlock}>
          <Text style={styles.noteLabel}>Главы</Text>
          <View style={styles.bookmarkList}>
            {timestamps.map((ts) => (
              <Pressable
                key={ts.id}
                onPress={() => onSeek(ts.positionSec)}
                style={styles.bookmarkRow}
              >
                <View style={styles.bookmarkTime}>
                  <Text style={styles.bookmarkTimeText}>
                    {formatPosition(ts.positionSec)}
                  </Text>
                </View>
                <Text style={styles.bookmarkLabel} numberOfLines={1}>
                  {ts.title}
                </Text>
              </Pressable>
            ))}
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
              <View key={b.id} style={styles.bookmarkRow}>
                <Pressable
                  onPress={() => onSeek(b.position)}
                  style={styles.bookmarkTime}
                >
                  <Text style={styles.bookmarkTimeText}>
                    {formatPosition(b.position)}
                  </Text>
                </Pressable>
                <Text style={styles.bookmarkLabel} numberOfLines={1}>
                  {b.label || "Без подписи"}
                </Text>
                <Pressable
                  onPress={() => onRemoveBookmark(b.id)}
                  hitSlop={8}
                  style={styles.bookmarkRemove}
                >
                  <Text style={styles.bookmarkRemoveText}>✕</Text>
                </Pressable>
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
          placeholder="Например: пробовал на спарринге, заходит на open guard"
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
  bookmarkRemove: {
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
  },
  bookmarkRemoveText: {
    fontSize: 16,
    color: theme.colors.muted,
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
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceMuted,
    lineHeight: 20,
  },
})
