import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback } from "react"
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { listMyVideoReviews } from "../../shared/api/video-reviews"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { isStaffWorkspace } from "../retention/retention-helpers"
import { isPlayable, myReviewsCacheKey } from "./review-helpers"
import { ReviewListItem } from "./ReviewListItem"

type Props = NativeStackScreenProps<RootStackParamList, "MyVideoReviews">

// While a clip of the list is still being transcoded it is re-read this often.
const PROCESSING_POLL_MS = 10_000

// «Мои разборы»: the clips the member sent for review, newest activity first.
// Staff also get the way to their students' requests from here.
export function MyVideoReviewsScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId ?? null
  const reviews = useCachedResource(
    workspaceId ? myReviewsCacheKey(workspaceId) : null,
    useCallback(
      async () => await listMyVideoReviews({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const items = reviews.data?.items ?? []
  const processing = items.some((i) => !isPlayable(i.status) && i.status !== "failed")

  const { refetch } = reviews
  useFocusEffect(
    useCallback(() => {
      if (!processing) return
      const id = setInterval(refetch, PROCESSING_POLL_MS)
      return () => clearInterval(id)
    }, [processing, refetch]),
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.top}>
          <Pressable
            onPress={() => navigation.navigate("NewVideoReview")}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>+ Отправить видео на разбор</Text>
          </Pressable>
          {isStaffWorkspace(workspace) && (
            <Pressable
              onPress={() => navigation.navigate("ClubVideoReviews")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Разборы учеников →</Text>
            </Pressable>
          )}
          {reviews.stale && <OfflineNotice message="Нет сети — показан сохранённый список" />}
        </View>

        {reviews.loading && !reviews.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : reviews.error && !reviews.data ? (
          <ErrorRetry message={reviews.error} onRetry={reviews.refetch} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ReviewListItem
                item={item}
                showMember={false}
                onPress={() =>
                  navigation.navigate("VideoReview", { requestId: item.id, title: item.title })
                }
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={reviews.refreshing}
                onRefresh={reviews.refetch}
                tintColor={theme.colors.accent}
              />
            }
            contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Пока нет разборов</Text>
                <Text style={styles.emptyHint}>
                  Снимите, как выполняете технику или упражнение, и отправьте видео —{" "}
                  {vocabulary.coach.nom} оставит комментарии прямо на нужных моментах.
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
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    top: { paddingHorizontal: theme.spacing(5), paddingTop: theme.spacing(3), gap: theme.spacing(2) },
    primary: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    primaryText: { color: theme.colors.accentText, fontSize: 14, fontWeight: "700" },
    secondary: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    pressed: { opacity: 0.85 },
    list: { padding: theme.spacing(5), paddingTop: theme.spacing(3), gap: theme.spacing(3) },
    empty: { alignItems: "center", paddingHorizontal: theme.spacing(8) },
    emptyWrap: { flex: 1, justifyContent: "center" },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      marginBottom: theme.spacing(2),
    },
    emptyHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
  })
