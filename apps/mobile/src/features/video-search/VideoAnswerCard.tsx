import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import type { VideoAnswer, VideoAnswerCitation } from "../../shared/api/video-answers"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatPosition } from "../video/format-position"
import { splitAnswer } from "./video-answer"

export type VideoAnswerView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; answer: VideoAnswer }

// «Спросить ИИ по видео клуба»: one card above the search results — the
// answer with its citations as chips that open the moment, the lessons they
// point to, and a reminder of where it comes from.
export function VideoAnswerCard({
  view,
  onOpen,
  onRetry,
}: {
  view: VideoAnswerView
  onOpen: (citation: VideoAnswerCitation) => void
  onRetry: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

  if (view.status === "loading") {
    return (
      <View style={[styles.card, styles.row]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={styles.muted}>Ищем ответ в видео клуба…</Text>
      </View>
    )
  }
  if (view.status === "error") {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite">
        <Text style={styles.text}>{view.message}</Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.link}>Повторить</Text>
        </Pressable>
      </View>
    )
  }

  const { answer } = view
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        {splitAnswer(answer.answer, answer.citations).map((part, i) =>
          part.kind === "text" ? (
            <Text key={i}>{part.text}</Text>
          ) : (
            <Text
              key={i}
              onPress={() => onOpen(part.citation)}
              accessibilityRole="link"
              accessibilityLabel={`Источник ${part.citation.n}: ${part.citation.title}, ${formatPosition(part.citation.startAt)} — открыть видео с этого места`}
              style={styles.chip}
            >
              {` ${part.citation.n} `}
            </Text>
          ),
        )}
      </Text>
      {answer.citations.length > 0 && (
        <View style={styles.sources}>
          {answer.citations.map((c) => (
            <Pressable
              key={c.n}
              onPress={() => onOpen(c)}
              accessibilityRole="button"
              accessibilityLabel={`Источник ${c.n}: ${c.title}, ${formatPosition(c.startAt)} — открыть видео с этого места`}
              style={({ pressed }) => [styles.source, pressed && styles.pressed]}
            >
              <Text style={styles.sourceN}>{c.n}</Text>
              <Text style={styles.sourceTitle} numberOfLines={1}>
                {c.title}
              </Text>
              <Text style={styles.sourceTime}>{formatPosition(c.startAt)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {answer.answered && (
        <Text style={styles.muted}>Ответ по видео клуба · может ошибаться</Text>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      gap: theme.spacing(3),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    row: { flexDirection: "row", alignItems: "center" },
    text: { fontSize: 15, lineHeight: 22, color: theme.colors.text },
    chip: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.sm,
      fontVariant: ["tabular-nums"],
    },
    sources: { gap: theme.spacing(1) },
    source: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(1),
    },
    sourceN: {
      minWidth: 20,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.sm,
      overflow: "hidden",
    },
    sourceTitle: { flex: 1, fontSize: 14, color: theme.colors.text },
    sourceTime: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    muted: { fontSize: 12, color: theme.colors.muted },
    retry: { alignSelf: "flex-start" },
    link: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
    pressed: { opacity: 0.85 },
  })
