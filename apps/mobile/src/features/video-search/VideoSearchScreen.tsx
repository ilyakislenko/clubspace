import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useNetworkState } from "expo-network"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  searchVideos,
  type VideoSearchItem,
} from "../../shared/api/video-search"
import {
  acceptVideoAnswersNotice,
  askClubVideos,
  getVideoAnswersState,
  type VideoAnswersState,
} from "../../shared/api/video-answers"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { showAlert } from "../../shared/alert"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { MIN_VIDEO_QUERY } from "./search-text"
import { Highlighted, MomentChip } from "./SearchMoment"
import { citationRoute, MIN_ASK_LENGTH } from "./video-answer"
import { VideoAnswerCard, type VideoAnswerView } from "./VideoAnswerCard"

type Props = NativeStackScreenProps<RootStackParamList, "VideoSearch">

const SEARCH_DEBOUNCE_MS = 350
// Server rejects longer queries.
const SEARCH_MAX_LENGTH = 100

// «Поиск по видео»: find the moment in the club's lessons where something is
// said (transcript or its Russian translation), or the chapter / lesson that
// names it. Results come from the server — there is no offline index.
export function VideoSearchScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const network = useNetworkState()
  // Unknown counts as online: the request is tried and fails into an error.
  const online =
    network.isConnected !== false && network.isInternetReachable !== false

  const [query, setQuery] = useState(
    (route.params?.q ?? "").slice(0, SEARCH_MAX_LENGTH),
  )
  const [search, setSearch] = useState(query.trim())
  const [items, setItems] = useState<VideoSearchItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  // Only the latest search may paint.
  const seq = useRef(0)

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  const workspaceId = workspace?.workspaceId
  useEffect(() => {
    const mine = ++seq.current
    if (!workspaceId || search.length < MIN_VIDEO_QUERY || !online) {
      setItems(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void searchVideos({ workspaceId, q: search })
      .then((res) => {
        if (mine === seq.current) setItems(res.items)
      })
      .catch((err: unknown) => {
        if (mine === seq.current) {
          setItems(null)
          setError(errorMessage(err, "Не удалось выполнить поиск."))
        }
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
  }, [workspaceId, search, online, retry])

  const open = useCallback(
    (item: VideoSearchItem, atSec?: number) =>
      navigation.navigate("Video", {
        videoId: item.video.id,
        courseId: item.course?.id,
        title: item.video.title,
        startAt: atSec,
      }),
    [navigation],
  )

  // «Спросить ИИ по видео клуба»: only when the club offers it to this member;
  // never on its own — the member taps the action for the typed text.
  const [answers, setAnswers] = useState<VideoAnswersState | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [answerView, setAnswerView] = useState<VideoAnswerView | null>(null)
  // Only the latest question may paint.
  const askSeq = useRef(0)

  useEffect(() => {
    if (!workspaceId || !online) return
    let alive = true
    void getVideoAnswersState({ workspaceId })
      .then((res) => alive && setAnswers(res))
      // An optional extra: unknown = not offered.
      .catch(() => alive && setAnswers(null))
    return () => {
      alive = false
    }
  }, [workspaceId, online])

  // The answer belongs to the question asked: editing the text drops it.
  useEffect(() => {
    if (asked !== null && query.trim() !== asked) {
      askSeq.current++
      setAsked(null)
      setAnswerView(null)
    }
  }, [query, asked])

  const runAsk = useCallback(
    async (question: string, acceptNotice?: string) => {
      if (!workspaceId) return
      const mine = ++askSeq.current
      setAsked(question)
      setAnswerView({ status: "loading" })
      try {
        if (acceptNotice) {
          const state = await acceptVideoAnswersNotice({ workspaceId, version: acceptNotice })
          if (mine === askSeq.current) setAnswers(state)
        }
        const answer = await askClubVideos({ workspaceId, question })
        if (mine === askSeq.current) setAnswerView({ status: "done", answer })
      } catch (err: unknown) {
        if (mine === askSeq.current) {
          setAnswerView({
            status: "error",
            message: errorMessage(err, "Не удалось получить ответ. Попробуйте ещё раз."),
          })
        }
      }
    },
    [workspaceId],
  )

  // Before the first question: the member agrees that it goes to the AI
  // service (kept on the server, asked once per club and edition).
  const ask = (question: string) => {
    if (!answers) return
    if (answers.noticeAccepted) {
      void runAsk(question)
      return
    }
    const { notice } = answers
    showAlert(notice.title, notice.text, [
      { text: "Отмена", style: "cancel" },
      { text: "Согласен, спросить", onPress: () => void runAsk(question, notice.version) },
    ])
  }

  const renderItem = ({ item }: { item: VideoSearchItem }) => (
    <View style={styles.card}>
      <Pressable
        onPress={() => open(item)}
        accessibilityRole="button"
        accessibilityLabel={`Открыть видео ${item.video.title}`}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        {item.video.thumbnailUrl ? (
          <Image source={{ uri: item.video.thumbnailUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <PlayGlyph />
          </View>
        )}
        <View style={styles.headText}>
          <Highlighted
            text={item.video.title}
            highlight={item.titleHighlight}
            style={styles.title}
            numberOfLines={2}
          />
          {item.course && (
            <Text style={styles.muted} numberOfLines={1}>
              {item.course.title}
            </Text>
          )}
        </View>
      </Pressable>
      {item.moments.length > 0 && (
        <View style={styles.moments}>
          {item.moments.map((moment, i) => (
            <MomentChip
              key={`${moment.atSec}-${moment.kind}-${i}`}
              moment={moment}
              onPress={() => open(item, moment.atSec)}
            />
          ))}
        </View>
      )}
    </View>
  )

  const status = (() => {
    if (!online) {
      return (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>Поиск по видео работает онлайн</Text>
          <Text style={styles.stateHint}>
            Чтобы найти момент по тому, что говорят в видео, нужен интернет.
            Загруженные видео можно открыть в «Загруженных».
          </Text>
        </View>
      )
    }
    if (search.length < MIN_VIDEO_QUERY) {
      return (
        <View style={styles.state}>
          <Text style={styles.stateHint}>
            Найдём момент, где это говорят, главу или видео с таким названием.
            Например: «кимура», «захват за рукав».
          </Text>
        </View>
      )
    }
    if (loading && !items) {
      return (
        <View style={styles.state}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      )
    }
    if (error) {
      return <ErrorRetry message={error} onRetry={() => setRetry((n) => n + 1)} />
    }
    return null
  })()

  const trimmed = query.trim()
  const canAsk =
    Boolean(answers?.available) &&
    online &&
    trimmed.length >= MIN_ASK_LENGTH &&
    asked !== trimmed
  const answerCard = answerView ? (
    <VideoAnswerCard
      view={answerView}
      onOpen={(citation) => navigation.navigate("Video", citationRoute(citation))}
      onRetry={() => asked && void runAsk(asked)}
    />
  ) : null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.top}>
          <View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Что сказано в видео, глава или название"
              placeholderTextColor={theme.colors.muted}
              style={styles.searchInput}
              autoCorrect={false}
              maxLength={SEARCH_MAX_LENGTH}
              autoCapitalize="none"
              autoFocus={!route.params?.q}
              returnKeyType="search"
              onSubmitEditing={() => setSearch(query.trim())}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Очистить поиск"
                style={styles.searchClear}
              >
                <Text style={styles.searchClearText}>✕</Text>
              </Pressable>
            )}
          </View>
          {canAsk && (
            <Pressable
              onPress={() => ask(trimmed)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.askButton, pressed && styles.pressed]}
            >
              <Text style={styles.askText}>Спросить ИИ по видео клуба</Text>
            </Pressable>
          )}
        </View>

        {status ? (
          <>
            {answerCard && <View style={styles.answerAbove}>{answerCard}</View>}
            {status}
          </>
        ) : (
          <FlatList
            data={items ?? []}
            keyExtractor={(item) => item.video.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={answerCard ?? undefined}
            contentContainerStyle={
              answerCard || (items && items.length > 0)
                ? styles.list
                : styles.emptyWrap
            }
            ListEmptyComponent={
              <View style={styles.state}>
                <Text style={styles.stateTitle}>Ничего не нашлось</Text>
                <Text style={styles.stateHint}>
                  Ищем в названиях, главах и в том, что говорят в видео, — для
                  видео с расшифровкой. Попробуйте другое слово.
                </Text>
              </View>
            }
          />
        )}
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    top: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(3),
      paddingBottom: theme.spacing(1),
    },
    searchInput: {
      height: 44,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(4),
      paddingRight: theme.spacing(10),
      fontSize: 15,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
    },
    searchClear: {
      position: "absolute",
      right: theme.spacing(2),
      top: 0,
      bottom: 0,
      width: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    searchClearText: { fontSize: 14, color: theme.colors.muted, fontWeight: "600" },
    askButton: {
      alignSelf: "flex-start",
      marginTop: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    askText: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
    answerAbove: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(3),
    },
    list: {
      padding: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(3),
    },
    card: {
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    head: { flexDirection: "row", gap: theme.spacing(3), alignItems: "center" },
    pressed: { opacity: 0.85 },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    headText: { flex: 1, gap: 3 },
    title: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    muted: { fontSize: 12, color: theme.colors.muted },
    moments: { gap: theme.spacing(2) },
    emptyWrap: { flexGrow: 1, justifyContent: "center" },
    state: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(8),
      paddingVertical: theme.spacing(8),
    },
    stateTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      textAlign: "center",
    },
    stateHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
  })
