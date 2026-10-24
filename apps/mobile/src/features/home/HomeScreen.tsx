import Ionicons from "@expo/vector-icons/Ionicons"
import { useFocusEffect } from "@react-navigation/native"
import React, { useCallback, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { TabScreenProps } from "../../app/navigation"
import { getAnnouncementFeed } from "../../shared/api/announcements"
import { getMyDropIns } from "../../shared/api/drop-ins"
import { getMyGroups } from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import { fetchMyMembership } from "../../shared/api/memberships"
import { listPersonalTrainings } from "../../shared/api/personal-trainings"
import { getMySubscription } from "../../shared/api/subscriptions"
import { useAuth } from "../../shared/auth-context"
import { brand } from "../../shared/brand"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { SplitLayout } from "../../shared/components/SplitLayout"
import { steppedFontSize } from "../../shared/size-class"
import { isFeatureEnabled } from "../../shared/feature-flags"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { EditNameModal } from "../profile/EditNameModal"
import { listRecents, type RecentEntry } from "../profile/preferences-store"
import {
  needsMyAction,
  viewerRole,
} from "../personal-training/personal-training-helpers"
import { accessStatus } from "../subscription/subscription-state"
import {
  AccessBanner,
  AnnouncementCard,
  ContinueRow,
  HomeFallback,
  NextClassCard,
  PersonalRequestsCard,
  SubscriptionCard,
} from "./HomeCards"
import { greetingName, showHomeFallback } from "./home-helpers"
import { NotificationBell } from "./NotificationBell"

export function HomeScreen({ navigation }: TabScreenProps<"Home">) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { sizeClass } = useResponsive()
  const workspaceId = workspace?.workspaceId
  const groupsOn = isFeatureEnabled(workspace, "groups")
  const attendanceOn = isFeatureEnabled(workspace, "attendance")
  const subscriptionOn = isFeatureEnabled(workspace, "subscription")
  const announcementsOn = isFeatureEnabled(workspace, "announcements")
  // Guest bookings feed «Ближайшая тренировка»; the owner has none. Read even
  // with guest visits off so existing bookings still show.
  const dropInsOn =
    isFeatureEnabled(workspace, "schedule") && !workspace?.isOwner
  const [editingName, setEditingName] = useState(false)
  const [recents, setRecents] = useState<RecentEntry[]>([])

  useFocusEffect(
    useCallback(() => {
      void listRecents().then(setRecents)
    }, []),
  )

  const me = useCachedResource(
    workspaceId ? `me:${workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  const membership = useCachedResource(
    workspaceId && !subscriptionOn ? `membership:${workspaceId}` : null,
    useCallback(
      async () => await fetchMyMembership({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Same keys as MyGroups / MySubscription, so each paints the other's data.
  const groups = useCachedResource(
    workspaceId && groupsOn ? `groups:${workspaceId}` : null,
    useCallback(
      async () => await getMyGroups({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Same key as the club schedule's, so each paints the other's data.
  const dropIns = useCachedResource(
    workspaceId && dropInsOn ? `dropins:me:${workspaceId}` : null,
    useCallback(
      async () => await getMyDropIns({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Same key as the personal-trainings list, so each paints the other's data.
  const personal = useCachedResource(
    workspaceId ? `personal-trainings:me:${workspaceId}` : null,
    useCallback(
      async () => await listPersonalTrainings({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  const subscription = useCachedResource(
    workspaceId && subscriptionOn ? `subscription:${workspaceId}` : null,
    useCallback(
      async () => await getMySubscription({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // A deeper key than the Announcements screen's, so this one-item page never
  // overwrites that list but still gets realtime invalidations.
  const announcements = useCachedResource(
    workspaceId && announcementsOn
      ? `announcements:${workspaceId}:latest`
      : null,
    useCallback(
      async () =>
        await getAnnouncementFeed({ workspaceId: workspaceId!, perPage: 1 }),
      [workspaceId],
    ),
  )

  const resources = [
    me,
    membership,
    groups,
    dropIns,
    personal,
    subscription,
    announcements,
  ]
  const refreshing = resources.some((r) => r.refreshing)
  // Guest bookings and personal sessions are a bonus on Home: never an error
  // banner.
  const failed = resources.find(
    (r) => r !== dropIns && r !== personal && r.error && !r.data,
  )
  const stale = resources.some((r) => r.stale && r.data)
  const refetchAll = () => resources.forEach((r) => r.refetch())

  if (!workspace) return null

  const name = greetingName(me.data)
  const access = !subscriptionOn
    ? accessStatus(membership.data?.accessUntil)
    : null
  const latestAnnouncement = announcements.data?.data[0]
  const hasRecents = recents.length > 0
  const lastRecent = recents[0]

  const bookings = dropIns.data?.bookings ?? []
  // As the student: the sessions where the viewer coaches show up on the
  // schedule, not as «my next class».
  const meId = me.data?.id
  const personalRequests = personal.data?.data ?? []
  const myPersonal = meId
    ? personalRequests.filter((pt) => viewerRole(pt, meId) === "member")
    : []
  const nextClass = ((groupsOn && groups.data) ||
    bookings.length > 0 ||
    myPersonal.length > 0) && (
    <NextClassCard
      groups={groupsOn ? (groups.data ?? []) : []}
      bookings={bookings}
      personal={myPersonal}
      onPress={() => navigation.navigate("Schedule")}
    />
  )

  const awaitingMe = meId
    ? personalRequests.filter((pt) => needsMyAction(pt, meId)).length
    : 0
  const coachRequests = awaitingMe > 0 && (
    <PersonalRequestsCard
      count={awaitingMe}
      onPress={() => navigation.navigate("PersonalTrainings")}
    />
  )

  const checkIn = attendanceOn && (
    <Pressable
      onPress={() => navigation.navigate("CheckIn")}
      accessibilityRole="button"
      style={styles.primaryCta}
    >
      <Ionicons
        name="checkmark-circle"
        size={22}
        color={theme.colors.accentText}
      />
      <Text style={styles.primaryCtaText}>Отметиться на тренировке</Text>
    </Pressable>
  )

  // On expanded these sit in SplitLayout's side column, beside a taller main
  // column: there is no row to line up with, so they keep their own height.
  const cardsGrow = sizeClass !== "expanded"

  const subscriptionCard = subscriptionOn && subscription.data && (
    <SubscriptionCard
      data={subscription.data}
      onPress={() => navigation.navigate("MySubscription")}
      grow={cardsGrow}
    />
  )

  const announcementCard = announcementsOn && latestAnnouncement && (
    <AnnouncementCard
      item={latestAnnouncement}
      onPress={() => navigation.navigate("Announcements")}
      grow={cardsGrow}
    />
  )

  const continueRow = lastRecent && (
    <ContinueRow
      recent={lastRecent}
      count={recents.length}
      onOpen={() =>
        navigation.navigate("Video", {
          videoId: lastRecent.videoId,
          courseId: lastRecent.courseId,
          title: lastRecent.title,
        })
      }
      onAll={() => navigation.navigate("ContinueWatching")}
    />
  )

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refetchAll}
              tintColor={theme.colors.accent}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow} numberOfLines={1}>
                {workspace.name ?? brand.displayName}
              </Text>
              <Text
                style={[
                  styles.title,
                  sizeClass !== "compact" && {
                    fontSize: steppedFontSize(
                      sizeClass,
                      theme.typography.title.fontSize,
                    ),
                  },
                ]}
                numberOfLines={1}
              >
                {name ? `Привет, ${name}` : "Привет!"}
              </Text>
              {me.data && !name && (
                <Pressable
                  onPress={() => setEditingName(true)}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.addName}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={theme.colors.accent}
                  />
                  <Text style={styles.addNameText}>Добавить имя</Text>
                </Pressable>
              )}
            </View>
            <NotificationBell />
          </View>

          {stale && <OfflineNotice />}

          {failed?.error && (
            <ErrorRetry message={failed.error} onRetry={refetchAll} />
          )}

          {access && access.variant !== "ok" && membership.data?.accessUntil && (
            <AccessBanner
              variant={access.variant}
              days={access.days}
              accessUntil={membership.data.accessUntil}
            />
          )}

          {sizeClass === "compact" ? (
            <>
              {nextClass}
              {coachRequests}
              {checkIn}
              {subscriptionCard}
              {announcementCard}
              {continueRow}
            </>
          ) : sizeClass === "medium" ? (
            <>
              <ResponsiveGrid fill>
                {nextClass}
                {subscriptionCard}
              </ResponsiveGrid>
              {coachRequests}
              {checkIn}
              <ResponsiveGrid fill>
                {announcementCard}
                {continueRow}
              </ResponsiveGrid>
            </>
          ) : (
            <SplitLayout
              main={
                <>
                  {nextClass}
                  {coachRequests}
                  {checkIn}
                  {continueRow}
                </>
              }
              side={
                <>
                  {subscriptionCard}
                  {announcementCard}
                </>
              }
            />
          )}

          {!failed && showHomeFallback({
            groupsOn:
              groupsOn || bookings.length > 0 || myPersonal.length > 0,
            attendanceOn,
            subscriptionOn,
            hasRecents,
            hasAnnouncement: announcementsOn && !!latestAnnouncement,
          }) && <HomeFallback onPress={() => navigation.navigate("Courses")} />}
        </ScrollView>
      </CenteredColumn>

      {editingName && me.data && (
        <EditNameModal
          me={me.data}
          onClose={() => setEditingName(false)}
          onSaved={(updated) => {
            me.mutate(updated)
            setEditingName(false)
          }}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
    },
    headerText: { flex: 1 },
    eyebrow: { ...theme.typography.label, marginBottom: 4 },
    title: { ...theme.typography.title, color: theme.colors.text },
    addName: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      marginTop: theme.spacing(1),
    },
    addNameText: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
    primaryCta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accent,
    },
    primaryCtaText: {
      color: theme.colors.accentText,
      fontSize: 16,
      fontWeight: "700",
    },
  })
