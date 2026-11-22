import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import type { ReviewCard, ReviewGrade } from "../../shared/api/bookmark-reviews"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { pluralRu } from "../../shared/format-ru"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useOfflineDownloadsAllowed } from "../../shared/use-offline-downloads"
import { uniqueTargets } from "../offline/bulk-download"
import { BulkDownloadPanel } from "../offline/BulkDownloadPanel"
import {
  useBulkDownload,
  type BulkDownloadCopy,
} from "../offline/use-bulk-download"
import { DrawingThumb } from "../video/DrawingCanvas"
import { formatBookmarkTime } from "../video/format-position"
import {
  dueAfterGrade,
  formatInterval,
  formatNextDue,
  GRADES,
} from "./review-helpers"
import { useMyReviews } from "./use-my-reviews"

type Props = NativeStackScreenProps<RootStackParamList, "Reviews">

const REVIEWS_BULK_COPY: BulkDownloadCopy = {
  confirmTitle: "Скачать всё для повторения?",
  allDoneTitle: "Всё уже скачано",
  allDoneMessage: "Видео всех карточек к повторению уже в загруженном.",
}

// «Повторение»: the member's due bookmarks and A–B segments, one card at a
// time. A grade advances at once — it's saved on the device and reaches the
// server now or after the next reconnect.
export function ReviewsScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId ?? null
  const { resource, view, grade } = useMyReviews(workspaceId)
  const offlineDownloads = useOfflineDownloadsAllowed()
  // For the gym: the lessons of the server's due list (cards graded here
  // today included — they come back soon). The API lists only due cards;
  // the upcoming ones are just a count, so their lessons aren't known here.
  const bulkTargets = useMemo(
    () =>
      uniqueTargets(
        (resource.data?.items ?? []).map((c) => ({
          videoId: c.video.id,
          thumbnailUrl: c.video.thumbnailUrl,
        })),
      ),
    [resource.data],
  )
  const bulk = useBulkDownload({
    workspaceId,
    targets: bulkTargets,
    copy: REVIEWS_BULK_COPY,
  })

  // This round's cards; until the first grade it follows the latest list
  // (the cached copy, then the fresh one), after that it stays put.
  const [round, setRound] = useState<ReviewCard[] | null>(null)
  const [index, setIndex] = useState(0)
  // The soonest due date among the cards graded this round (ms).
  const [roundNextDue, setRoundNextDue] = useState<number | null>(null)

  useEffect(() => {
    if (view && index === 0) setRound(view.items)
  }, [view, index])

  const card = round?.[index]
  const done = round !== null && index >= round.length
  const { refetch } = resource
  // A finished round asks for what's next (past the list's cap).
  useEffect(() => {
    if (done && index > 0) refetch()
  }, [done, index, refetch])

  const openVideo = (c: ReviewCard) =>
    navigation.navigate("Video", {
      videoId: c.video.id,
      courseId: c.course?.id,
      title: c.video.title,
      startAt: c.bookmark.positionSec,
      loopEndAt: c.bookmark.endSec ?? undefined,
      // A moment with a drawing opens paused on it, drawing shown.
      drawingBookmarkId:
        c.bookmark.drawing && c.bookmark.endSec == null ? c.bookmark.id : undefined,
    })

  const onGrade = (c: ReviewCard, value: ReviewGrade) => {
    const now = Date.now()
    const due = dueAfterGrade(now, c.nextIntervals[value])
    setRoundNextDue((prev) => (prev === null ? due : Math.min(prev, due)))
    setIndex((i) => i + 1)
    haptics.light()
    void grade(c, value, new Date(now))
  }

  const startNextRound = () => {
    setRoundNextDue(null)
    setIndex(0)
  }

  if (!view) {
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

  const renderCard = (c: ReviewCard, position: number, total: number) => (
    <>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {position} из {total}
        </Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${(Math.max(0, position - 1) / total) * 100}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={() => openVideo(c)}
          accessibilityRole="button"
          accessibilityLabel={`Смотреть ${c.video.title} с ${formatBookmarkTime(c.bookmark)}`}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {c.video.thumbnailUrl ? (
            <Image source={{ uri: c.video.thumbnailUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <PlayGlyph size={28} />
            </View>
          )}
        </Pressable>

        <View style={styles.cardBody}>
          <View style={styles.titles}>
            <Text style={styles.videoTitle} numberOfLines={2}>
              {c.video.title}
            </Text>
            {c.course && (
              <Text style={styles.muted} numberOfLines={1}>
                {c.course.title}
              </Text>
            )}
          </View>

          <View style={styles.bookmarkRow}>
            <View style={styles.timeChip}>
              <Text style={styles.timeText}>
                {formatBookmarkTime(c.bookmark)}
                {c.bookmark.drawing ? " ✎" : ""}
              </Text>
            </View>
            {c.bookmark.drawing && <DrawingThumb strokes={c.bookmark.drawing.strokes} />}
            <Text
              style={c.bookmark.label ? styles.label : styles.labelEmpty}
              numberOfLines={2}
            >
              {c.bookmark.label || "Без названия"}
            </Text>
          </View>
          {c.bookmark.note ? (
            <Text style={styles.note}>{c.bookmark.note}</Text>
          ) : null}

          <Pressable
            onPress={() => openVideo(c)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.watch, pressed && styles.pressed]}
          >
            <PlayGlyph size={12} color={theme.colors.accent} />
            <Text style={styles.watchText}>
              {c.bookmark.endSec != null ? "Смотреть отрезок" : "Смотреть"}
            </Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.askText}>Насколько хорошо вы это помните?</Text>
      <View style={styles.grades}>
        {GRADES.map(({ grade: value, label }) => {
          const hint = formatInterval(c.nextIntervals[value])
          return (
            <Pressable
              key={value}
              onPress={() => onGrade(c, value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}, следующее повторение через ${hint}`}
              style={({ pressed }) => [
                styles.gradeButton,
                gradeStyle(styles, value),
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.gradeLabel, gradeTextStyle(styles, value)]}>
                {label}
              </Text>
              <Text style={[styles.gradeHint, gradeTextStyle(styles, value)]}>
                {hint}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </>
  )

  const renderDone = () => {
    if (view.totalCount === 0 && index === 0) {
      return (
        <View style={styles.doneBox}>
          <Text style={styles.doneTitle}>Пока нечего повторять</Text>
          <Text style={styles.doneText}>
            Сохраняйте закладки и отрезки под видео — через день они появятся
            здесь, и приложение напомнит повторить их, пока техника не
            запомнится.
          </Text>
        </View>
      )
    }
    const serverNext = view.nextDueAt ? Date.parse(view.nextDueAt) : null
    const candidates = [serverNext, roundNextDue].filter(
      (t): t is number => t !== null,
    )
    const nextDue = candidates.length > 0 ? Math.min(...candidates) : null
    const left = view.items.length
    return (
      <View style={styles.doneBox}>
        <Text style={styles.doneTitle}>На сегодня всё</Text>
        {index > 0 && (
          <Text style={styles.doneText}>
            Повторено: {index}{" "}
            {pluralRu(index, "карточка", "карточки", "карточек")}
          </Text>
        )}
        {nextDue !== null && (
          <Text style={styles.doneText}>
            Следующее повторение — {formatNextDue(nextDue, Date.now())}
          </Text>
        )}
        {view.upcomingCount > 0 && (
          <Text style={styles.muted}>
            В ближайшие 7 дней: {view.upcomingCount}{" "}
            {pluralRu(view.upcomingCount, "карточка", "карточки", "карточек")}
          </Text>
        )}
        {left > 0 && (
          <Pressable
            onPress={startNextRound}
            accessibilityRole="button"
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
          >
            <Text style={styles.moreText}>
              Ещё {left} {pluralRu(left, "карточка", "карточки", "карточек")}
            </Text>
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={resource.refreshing}
              onRefresh={resource.refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {resource.stale && (
            <OfflineNotice message="Нет сети — оценки отправятся, когда появится интернет" />
          )}
          {offlineDownloads && bulk.total > 0 && (
            <BulkDownloadPanel
              bulk={bulk}
              label="Скачать всё для повторения"
              allDownloadedLabel="Всё для повторения загружено"
            />
          )}
          {card && round
            ? renderCard(card, index + 1, round.length)
            : done && renderDone()}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

type Styles = ReturnType<typeof makeStyles>

const gradeStyle = (styles: Styles, grade: ReviewGrade) =>
  ({
    again: styles.gradeAgain,
    hard: styles.gradeHard,
    good: styles.gradeGood,
    easy: styles.gradeEasy,
  })[grade]

const gradeTextStyle = (styles: Styles, grade: ReviewGrade) =>
  ({
    again: styles.gradeAgainText,
    hard: styles.gradeHardText,
    good: styles.gradeGoodText,
    easy: styles.gradeEasyText,
  })[grade]

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    body: {
      padding: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(4),
    },
    pressed: { opacity: 0.85 },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
    },
    progressText: {
      ...theme.typography.label,
      fontVariant: ["tabular-nums"],
    },
    progressBar: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.surfaceMuted,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
    card: {
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
      ...theme.shadows.sm,
    },
    cover: {
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: theme.colors.surfaceMuted,
    },
    coverPlaceholder: { alignItems: "center", justifyContent: "center" },
    cardBody: { padding: theme.spacing(4), gap: theme.spacing(3) },
    titles: { gap: 2 },
    videoTitle: { ...theme.typography.heading, color: theme.colors.text },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    bookmarkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 4,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    label: { ...theme.typography.bodyStrong, color: theme.colors.text, flex: 1 },
    labelEmpty: { ...theme.typography.body, color: theme.colors.muted, flex: 1 },
    note: { ...theme.typography.body, color: theme.colors.text },
    watch: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.accent,
    },
    watchText: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
    askText: {
      ...theme.typography.caption,
      color: theme.colors.muted,
      textAlign: "center",
    },
    grades: { flexDirection: "row", gap: theme.spacing(2) },
    gradeButton: {
      flex: 1,
      alignItems: "center",
      gap: 2,
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
    },
    gradeLabel: { fontSize: 15, fontWeight: "700" },
    gradeHint: { fontSize: 12, fontVariant: ["tabular-nums"] },
    gradeAgain: { backgroundColor: theme.colors.dangerSoft },
    gradeAgainText: { color: theme.colors.danger },
    gradeHard: { backgroundColor: theme.colors.warningSoft },
    gradeHardText: { color: theme.colors.warning },
    gradeGood: { backgroundColor: theme.colors.accent },
    gradeGoodText: { color: theme.colors.accentText },
    gradeEasy: { backgroundColor: theme.colors.successSoft },
    gradeEasyText: { color: theme.colors.success },
    doneBox: {
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(10),
      paddingHorizontal: theme.spacing(6),
    },
    doneTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      textAlign: "center",
    },
    doneText: {
      ...theme.typography.body,
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
    moreButton: {
      marginTop: theme.spacing(3),
      paddingHorizontal: theme.spacing(5),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    moreText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
  })
