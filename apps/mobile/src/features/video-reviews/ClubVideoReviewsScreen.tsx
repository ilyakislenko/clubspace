import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  listClubVideoReviews,
  type VideoReviewSummary,
} from "../../shared/api/video-reviews"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { clubReviewsCacheKey } from "./review-helpers"
import { ReviewListItem } from "./ReviewListItem"

type Props = NativeStackScreenProps<RootStackParamList, "ClubVideoReviews">

const SECTIONS: { title: string; matches: (s: VideoReviewSummary["status"]) => boolean }[] = [
  // Uploaded clips still being processed wait for an answer too.
  { title: "Ждут ответа", matches: (s) => s === "open" || s === "processing" },
  { title: "Отвечены", matches: (s) => s === "answered" },
  { title: "Закрыты и с ошибкой", matches: (s) => s === "closed" || s === "failed" },
]

// «Разборы учеников» (staff): the club's review requests, the waiting ones
// first (the server's order), grouped by status.
export function ClubVideoReviewsScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId ?? null
  const reviews = useCachedResource(
    workspaceId ? clubReviewsCacheKey(workspaceId) : null,
    useCallback(
      async () => await listClubVideoReviews({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const items = reviews.data?.items ?? []
  const sections = SECTIONS.map((s) => ({
    title: s.title,
    data: items.filter((i) => s.matches(i.status)),
  })).filter((s) => s.data.length > 0)

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        {reviews.stale && (
          <View style={styles.top}>
            <OfflineNotice message="Нет сети — показан сохранённый список" />
          </View>
        )}
        {reviews.loading && !reviews.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : reviews.error && !reviews.data ? (
          <ErrorRetry message={reviews.error} onRetry={reviews.refetch} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionTitle}>
                {section.title} · {section.data.length}
              </Text>
            )}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <ReviewListItem
                  item={item}
                  showMember
                  onPress={() =>
                    navigation.navigate("VideoReview", { requestId: item.id, title: item.title })
                  }
                />
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={reviews.refreshing}
                onRefresh={reviews.refetch}
                tintColor={theme.colors.accent}
              />
            }
            stickySectionHeadersEnabled={false}
            contentContainerStyle={sections.length === 0 ? styles.emptyWrap : styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Разборов пока нет</Text>
                <Text style={styles.emptyHint}>
                  Когда ученик отправит видео, оно появится здесь, а вам придёт уведомление.
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
    top: { paddingHorizontal: theme.spacing(5), paddingTop: theme.spacing(3) },
    list: { padding: theme.spacing(5), paddingTop: theme.spacing(2) },
    row: { marginBottom: theme.spacing(3) },
    sectionTitle: {
      ...theme.typography.label,
      marginTop: theme.spacing(3),
      marginBottom: theme.spacing(2),
    },
    empty: { alignItems: "center", paddingHorizontal: theme.spacing(8) },
    emptyWrap: { flex: 1, justifyContent: "center" },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      marginBottom: theme.spacing(2),
    },
    emptyHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
  })
