// Fullscreen «Главы» drawer: the lesson's chapters and the member's own
// bookmarks/segments, sliding over the right edge of the picture so the
// lesson keeps playing beside it. Same targets as the side panel (which
// fullscreen hides): a chapter seeks; a bookmark opens like a panel row
// (seek, segment loop, or its drawing on the paused frame); «В план»
// adds the row to a study plan; the share icon sends a link to the moment.
import React, { useRef } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native"
import type { EdgeInsets } from "react-native-safe-area-context"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { BookmarkDrawing } from "../../shared/api/video-study"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  bookmarkOpenLabel,
  formatBookmarkTime,
  formatPosition,
} from "./format-position"
import type { SharedMoment } from "./moment-link"

export type PlayerChapter = { id: string; positionSec: number; title: string }
export type PlayerBookmark = {
  id: string
  positionSec: number
  endSec: number | null
  label: string
  drawing: BookmarkDrawing | null
}

// Rows above the current chapter left visible when the list opens scrolled.
const SCROLL_CONTEXT_PX = 96

type Props = {
  chapters: ReadonlyArray<PlayerChapter>
  bookmarks: ReadonlyArray<PlayerBookmark>
  // -1 = before the first chapter.
  currentChapter: number
  insets: EdgeInsets
  onSeek: (sec: number) => void
  onOpenBookmark: (bookmark: PlayerBookmark) => void
  onShareMoment: (moment: SharedMoment) => void
  onClose: () => void
  // «В план» on each row (omitted = no button).
  onAddChapterToPlan?: (index: number) => void
  onAddBookmarkToPlan?: (bookmarkId: string) => void
}

export function ChapterDrawer({
  chapters,
  bookmarks,
  currentChapter,
  insets,
  onSeek,
  onOpenBookmark,
  onShareMoment,
  onClose,
  onAddChapterToPlan,
  onAddBookmarkToPlan,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollViewInstance>(null)
  // A long chapter list opens on the current chapter, once.
  const scrolled = useRef(false)

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tap outside the panel closes it (the panel's ✕ is the labelled way). */}
      <Pressable
        accessibilityRole="none"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <View
        style={[
          styles.panel,
          {
            paddingTop: theme.spacing(2) + insets.top,
            paddingBottom: insets.bottom,
            paddingRight: insets.right,
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.heading}>Главы</Text>
          <Pressable
            onPress={onClose}
            accessibilityLabel="Закрыть список глав"
            hitSlop={6}
            style={styles.close}
          >
            <Icon name="close" size={22} color={theme.colors.onOverlay} />
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {chapters.map((c, i) => {
            const current = i === currentChapter
            return (
              <Pressable
                key={c.id}
                onPress={() => onSeek(c.positionSec)}
                accessibilityLabel={`Глава ${i + 1}: ${c.title}, ${formatPosition(c.positionSec)}`}
                accessibilityState={current ? { selected: true } : undefined}
                onLayout={
                  current
                    ? (e) => {
                        if (scrolled.current) return
                        scrolled.current = true
                        scrollRef.current?.scrollTo({
                          y: Math.max(0, e.nativeEvent.layout.y - SCROLL_CONTEXT_PX),
                          animated: false,
                        })
                      }
                    : undefined
                }
                style={[styles.row, current && styles.rowCurrent]}
              >
                <View style={[styles.timeChip, current && styles.timeChipCurrent]}>
                  <Text style={[styles.timeText, current && styles.textCurrent]}>
                    {formatPosition(c.positionSec)}
                  </Text>
                </View>
                <Text
                  style={[styles.rowTitle, current && styles.textCurrent]}
                  numberOfLines={2}
                >
                  {c.title}
                </Text>
                <ShareMomentButton
                  label={`Поделиться главой ${c.title}`}
                  current={current}
                  onPress={() => onShareMoment({ startSec: c.positionSec, label: c.title })}
                />
                {onAddChapterToPlan && (
                  <AddToPlanChip
                    label={`Добавить главу ${c.title} в план`}
                    current={current}
                    onPress={() => onAddChapterToPlan(i)}
                  />
                )}
              </Pressable>
            )
          })}

          {bookmarks.length > 0 && (
            <Text style={[styles.heading, styles.sectionHeading]}>Закладки</Text>
          )}
          {bookmarks.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => onOpenBookmark(b)}
              accessibilityLabel={bookmarkOpenLabel(b)}
              style={styles.row}
            >
              <View style={styles.timeChip}>
                <Text style={styles.timeText}>{formatBookmarkTime(b)}</Text>
              </View>
              <Text
                style={b.label ? styles.rowTitle : styles.rowTitleEmpty}
                numberOfLines={2}
              >
                {b.label || "Без названия"}
              </Text>
              {b.drawing && <Text style={styles.drawingMark}>✎</Text>}
              <ShareMomentButton
                label={`Поделиться закладкой ${b.label || formatBookmarkTime(b)}`}
                onPress={() =>
                  onShareMoment({ startSec: b.positionSec, endSec: b.endSec, label: b.label })
                }
              />
              {onAddBookmarkToPlan && (
                <AddToPlanChip
                  label={`Добавить закладку ${b.label || formatBookmarkTime(b)} в план`}
                  onPress={() => onAddBookmarkToPlan(b.id)}
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: { backgroundColor: theme.colors.overlaySoft },
    panel: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: "40%",
      minWidth: 280,
      maxWidth: 420,
      backgroundColor: theme.colors.overlayStrong,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: theme.spacing(4),
      paddingRight: theme.spacing(2),
      paddingBottom: theme.spacing(2),
    },
    heading: {
      color: theme.colors.onOverlay,
      fontSize: 16,
      fontWeight: "700",
    },
    sectionHeading: {
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(1),
      paddingHorizontal: theme.spacing(2),
    },
    close: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    list: { flex: 1 },
    listContent: {
      paddingHorizontal: theme.spacing(2),
      paddingBottom: theme.spacing(4),
      gap: theme.spacing(1),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(2),
      borderRadius: theme.radius.md,
    },
    rowCurrent: { backgroundColor: theme.colors.accent },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
    },
    timeChipCurrent: { borderColor: theme.colors.accentText },
    timeText: {
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    rowTitle: {
      flex: 1,
      color: theme.colors.onOverlay,
      fontSize: 14,
    },
    drawingMark: { color: theme.colors.onOverlay, fontSize: 16 },
    rowTitleEmpty: {
      flex: 1,
      color: theme.colors.onOverlay,
      fontSize: 14,
      fontStyle: "italic",
      opacity: 0.7,
    },
    textCurrent: { color: theme.colors.accentText, fontWeight: "700" },
    addToPlan: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 4,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
    },
    addToPlanCurrent: { borderColor: theme.colors.accentText },
    addToPlanText: { color: theme.colors.onOverlay, fontSize: 12, fontWeight: "600" },
    share: { paddingHorizontal: theme.spacing(1), paddingVertical: 2 },
  })

// «В план» at the end of a drawer row.
function AddToPlanChip({
  label,
  current = false,
  onPress,
}: {
  label: string
  current?: boolean
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.addToPlan, current && styles.addToPlanCurrent]}
    >
      <Text style={[styles.addToPlanText, current && styles.textCurrent]}>В план</Text>
    </Pressable>
  )
}

// «Поделиться моментом» at the end of a drawer row.
function ShareMomentButton({
  label,
  current = false,
  onPress,
}: {
  label: string
  current?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.share}
    >
      <Icon
        name="share-outline"
        size={18}
        color={current ? theme.colors.accentText : theme.colors.onOverlay}
      />
    </Pressable>
  )
}
