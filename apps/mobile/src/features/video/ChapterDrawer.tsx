// Fullscreen «Главы» drawer: the lesson's chapters and the member's own
// bookmarks/segments, sliding over the right edge of the picture so the
// lesson keeps playing beside it. Same targets as the side panel (which
// fullscreen hides): a chapter seeks; a bookmark opens like a panel row
// (seek, segment loop, or its drawing on the paused frame); «⋯» on a row
// holds «В план» and «Поделиться моментом».
import React, { useRef, useState } from "react"
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
import { MoreButton } from "./MenuOption"
import type { SharedMoment } from "./moment-link"
import { MomentMenuSheet } from "./MomentMenuSheet"

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
  // «В план» in a row's menu (omitted = not offered).
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
  // The row whose «⋯» menu is open.
  const [menu, setMenu] = useState<
    { kind: "chapter"; index: number } | { kind: "bookmark"; id: string } | null
  >(null)
  const menuChapter = menu?.kind === "chapter" ? chapters[menu.index] : undefined
  const menuBookmark =
    menu?.kind === "bookmark" ? bookmarks.find((b) => b.id === menu.id) : undefined

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tap outside the panel closes it (the panel's close is the labelled way). */}
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
            const openMenu = () => setMenu({ kind: "chapter", index: i })
            return (
              <View
                key={c.id}
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
                <Pressable
                  onPress={() => onSeek(c.positionSec)}
                  onLongPress={openMenu}
                  accessibilityLabel={`Глава ${i + 1}: ${c.title}, ${formatPosition(c.positionSec)}`}
                  accessibilityState={current ? { selected: true } : undefined}
                  style={styles.rowMain}
                >
                  <Text style={[styles.timeText, current && styles.textCurrent]}>
                    {formatPosition(c.positionSec)}
                  </Text>
                  <Text
                    style={[styles.rowTitle, current && styles.textCurrent]}
                    numberOfLines={2}
                  >
                    {c.title}
                  </Text>
                </Pressable>
                <MoreButton
                  onPress={openMenu}
                  hint={`Глава ${c.title}`}
                  color={current ? theme.colors.accentText : theme.colors.onOverlay}
                />
              </View>
            )
          })}

          {bookmarks.length > 0 && (
            <Text style={[styles.heading, styles.sectionHeading]}>Закладки</Text>
          )}
          {bookmarks.map((b) => {
            const openMenu = () => setMenu({ kind: "bookmark", id: b.id })
            return (
              <View key={b.id} style={styles.row}>
                <Pressable
                  onPress={() => onOpenBookmark(b)}
                  onLongPress={openMenu}
                  accessibilityLabel={bookmarkOpenLabel(b)}
                  style={styles.rowMain}
                >
                  <Text style={styles.timeText}>{formatBookmarkTime(b)}</Text>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {b.label}
                  </Text>
                  {b.drawing && (
                    <Icon name="brush-outline" size={16} color={theme.colors.onOverlay} />
                  )}
                </Pressable>
                <MoreButton
                  onPress={openMenu}
                  hint={`Закладка ${b.label || formatBookmarkTime(b)}`}
                  color={theme.colors.onOverlay}
                />
              </View>
            )
          })}
        </ScrollView>
      </View>

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
        />
      )}
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
      borderRadius: theme.radius.md,
    },
    rowMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      paddingLeft: theme.spacing(2),
    },
    rowCurrent: { backgroundColor: theme.colors.accent },
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
    textCurrent: { color: theme.colors.accentText, fontWeight: "700" },
  })
