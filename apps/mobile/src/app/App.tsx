import {
  DefaultTheme,
  getFocusedRouteNameFromRoute,
  NavigationContainer,
} from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React, { useEffect } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AccessExpiredScreen } from "../features/auth/AccessExpiredScreen"
import { NoWorkspaceScreen } from "../features/auth/NoWorkspaceScreen"
import { SignInScreen } from "../features/auth/SignInScreen"
import { JoinClubScreen } from "../features/join/JoinClubScreen"
import {
  flushPendingJoin,
  initPendingJoinCapture,
  setPendingJoinRoutingEnabled,
} from "../features/join/pending-join"
import { CourseDetailScreen } from "../features/courses/CourseDetailScreen"
import { ContinueWatchingScreen } from "../features/courses/ContinueWatchingScreen"
import { OfflineLibraryScreen } from "../features/offline/OfflineLibraryScreen"
import { GymsScreen } from "../features/groups/GymsScreen"
import { MyGroupsScreen } from "../features/groups/MyGroupsScreen"
import { ClubAboutScreen } from "../features/club/ClubAboutScreen"
import { EventsScreen } from "../features/schedule/EventsScreen"
import { SessionAttendanceScreen } from "../features/attendance/SessionAttendanceScreen"
import { PersonalTrainingRequestScreen } from "../features/personal-training/PersonalTrainingRequestScreen"
import { PersonalTrainingScreen } from "../features/personal-training/PersonalTrainingScreen"
import { PersonalTrainingsScreen } from "../features/personal-training/PersonalTrainingsScreen"
import { MyAttendanceScreen } from "../features/attendance/MyAttendanceScreen"
import { CheckInScreen } from "../features/attendance/CheckInScreen"
import { CoachMemberSubscriptionScreen } from "../features/subscription/CoachMemberSubscriptionScreen"
import { MySubscriptionScreen } from "../features/subscription/MySubscriptionScreen"
import { MyRanksScreen } from "../features/ranks/MyRanksScreen"
import { AchievementsScreen } from "../features/achievements/AchievementsScreen"
import { JournalScreen } from "../features/journal/JournalScreen"
import { AnnouncementsScreen } from "../features/announcements/AnnouncementsScreen"
import { LeaderboardScreen } from "../features/leaderboard/LeaderboardScreen"
import { AtRiskMembersScreen } from "../features/retention/AtRiskMembersScreen"
import { FavoritesScreen } from "../features/profile/FavoritesScreen"
import { NotificationsScreen } from "../features/notifications/NotificationsScreen"
import {
  flushPendingPush,
  usePushNotificationRouting,
} from "../features/notifications/push-routing"
import { useRealtime } from "../shared/realtime/realtime"
import { useNetworkReconnect } from "../shared/cache/useNetworkReconnect"
import { SettingsScreen } from "../features/profile/SettingsScreen"
import { DrillProvider } from "../features/video/DrillMode"
import { VideoScreen } from "../features/video/VideoScreen"
import { ToastProvider } from "../shared/components/Toast"
import { AuthProvider, useAuth } from "../shared/auth-context"
import { brand } from "../shared/brand"
import type { Theme } from "../shared/theme"
import {
  ThemeProvider,
  useTheme,
  useThemedStyles,
} from "../shared/theme-context"
import { ThemedBackground } from "../shared/ThemedBackground"
import { isWeb } from "../shared/platform"
import { useResponsive } from "../shared/useResponsive"
import { DesktopSidebar } from "./DesktopSidebar"
import { formatDocumentTitle, webLinking } from "./linking"
import { MainTabs } from "./MainTabs"
import { navHeaderOptions } from "./nav-header-options"
import { navigationRef, type RootStackParamList } from "./navigation"
import { tabTitle } from "./tab-routes"

const Stack = createNativeStackNavigator<RootStackParamList>()

// Module scope, before the first render: a join link must be read before React
// Navigation (on web) rewrites the URL.
initPendingJoinCapture()

// The navigator's scene background is transparent so the app-wide
// ThemedBackground (a gradient for glass, a flat colour otherwise) shows
// through; each screen still paints its own opaque background except glass.
const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "transparent" },
}

function RootStack({ activeRoute }: { activeRoute?: string }) {
  const { ready, authed, workspace } = useAuth()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { isDesktop } = useResponsive()
  usePushNotificationRouting(authed, workspace)
  useRealtime(authed)
  useNetworkReconnect()

  // A join link held while signed out / without a club opens the join screen
  // once the member is in and past the lock screen.
  useEffect(
    () =>
      setPendingJoinRoutingEnabled(
        ready && authed && !workspace?.accessExpired,
      ),
    [ready, authed, workspace?.accessExpired],
  )

  // Only once signed in and past the no-workspace / expired gates — those
  // screens are full-bleed dead ends with nowhere to navigate.
  const showSidebar =
    isWeb && isDesktop && authed && !!workspace && !workspace.accessExpired

  if (!ready) {
    return (
      <View style={styles.splash}>
        <View style={styles.splashContent}>
          <Text style={styles.splashTitle}>{brand.displayName}</Text>
          <Text style={styles.splashTagline}>{brand.tagline}</Text>
        </View>
        <ActivityIndicator
          color={theme.colors.accent}
          style={styles.splashSpinner}
        />
      </View>
    )
  }

  if (authed && workspace?.accessExpired) {
    return <AccessExpiredScreen />
  }

  return (
    <View style={[styles.fill, showSidebar && styles.shell]}>
      {showSidebar && <DesktopSidebar activeRoute={activeRoute} />}
      <View style={styles.fill}>
      <Stack.Navigator
        screenOptions={{
          ...navHeaderOptions(theme),
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
      {authed && !workspace ? (
        // Distinct keys: when the branch flips (a join just got accepted) the
        // router drops the old branch's routes instead of keeping JoinClub.
        <Stack.Group navigationKey="onboarding">
          <Stack.Screen
            name="Onboarding"
            component={NoWorkspaceScreen}
            options={{ headerShown: false, title: "Добро пожаловать" }}
          />
          <Stack.Screen
            name="JoinClub"
            component={JoinClubScreen}
            options={{ title: "Вступить в клуб" }}
          />
        </Stack.Group>
      ) : authed ? (
        <Stack.Group navigationKey="member">
          <Stack.Screen
            name="Main"
            component={MainTabs}
            // The tabs draw their own headers. `title` follows the focused tab
            // because it's what the browser tab and the *next* screen's back
            // button are labelled with.
            options={({ route }) => ({
              headerShown: false,
              title: tabTitle(getFocusedRouteNameFromRoute(route)),
            })}
          />
          <Stack.Screen
            name="CourseDetail"
            component={CourseDetailScreen}
            options={({ route }) => ({
              title: route.params.title ?? "Курс",
            })}
          />
          <Stack.Screen
            name="Video"
            component={VideoScreen}
            options={({ route }) => ({
              title: route.params.title ?? "Видео",
            })}
          />
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{ title: "Уведомления" }}
          />
          <Stack.Screen
            name="OfflineLibrary"
            component={OfflineLibraryScreen}
            options={{ title: "Загруженные" }}
          />
          <Stack.Screen
            name="ContinueWatching"
            component={ContinueWatchingScreen}
            options={{ title: "Продолжить" }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: "Настройки" }}
          />
          <Stack.Screen
            name="Favorites"
            component={FavoritesScreen}
            options={{ title: "Избранное" }}
          />
          <Stack.Screen
            name="MyGroups"
            component={MyGroupsScreen}
            options={{ title: "Мои группы" }}
          />
          <Stack.Screen
            name="Gyms"
            component={GymsScreen}
            options={{ title: "Залы" }}
          />
          <Stack.Screen
            name="Events"
            component={EventsScreen}
            options={{ title: "События" }}
          />
          <Stack.Screen
            name="ClubAbout"
            component={ClubAboutScreen}
            options={{ title: "О клубе" }}
          />
          <Stack.Screen
            name="SessionAttendance"
            component={SessionAttendanceScreen}
            options={{ title: "Посещаемость" }}
          />
          <Stack.Screen
            name="SessionRoster"
            component={SessionAttendanceScreen}
            options={{ title: "Посещаемость" }}
          />
          <Stack.Screen
            name="PersonalTrainings"
            component={PersonalTrainingsScreen}
            options={{ title: "Персональные тренировки" }}
          />
          <Stack.Screen
            name="PersonalTrainingRequest"
            component={PersonalTrainingRequestScreen}
            options={{ title: "Новая заявка" }}
          />
          <Stack.Screen
            name="PersonalTraining"
            component={PersonalTrainingScreen}
            options={{ title: "Персональная тренировка" }}
          />
          <Stack.Screen
            name="MyAttendance"
            component={MyAttendanceScreen}
            options={{ title: "Моя посещаемость" }}
          />
          <Stack.Screen
            name="CheckIn"
            component={CheckInScreen}
            options={{ title: "Отметиться на тренировке" }}
          />
          <Stack.Screen
            name="MySubscription"
            component={MySubscriptionScreen}
            options={{ title: "Мой абонемент" }}
          />
          <Stack.Screen
            name="MyRanks"
            component={MyRanksScreen}
            options={{ title: "Мой ранг" }}
          />
          <Stack.Screen
            name="Achievements"
            component={AchievementsScreen}
            options={{ title: "Достижения" }}
          />
          <Stack.Screen
            name="Journal"
            component={JournalScreen}
            options={{ title: "Дневник тренировок" }}
          />
          <Stack.Screen
            name="Announcements"
            component={AnnouncementsScreen}
            options={{ title: "Объявления" }}
          />
          <Stack.Screen
            name="Leaderboard"
            component={LeaderboardScreen}
            options={{ title: "Рейтинг" }}
          />
          <Stack.Screen
            name="AtRiskMembers"
            component={AtRiskMembersScreen}
            options={{ title: "Кому позвонить" }}
          />
          <Stack.Screen
            name="MemberSubscription"
            component={CoachMemberSubscriptionScreen}
            options={{ title: "Абонемент ученика" }}
          />
          <Stack.Screen
            name="JoinClub"
            component={JoinClubScreen}
            options={{ title: "Вступить в клуб" }}
          />
        </Stack.Group>
      ) : (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: false, title: "Вход" }}
        />
      )}
      </Stack.Navigator>
      </View>
    </View>
  )
}

export const App = () => {
  // The desktop sidebar highlights the screen you're on. It renders alongside
  // the navigator rather than inside it, so it can't read navigation state via
  // a hook — the container reports the current route instead.
  const [activeRoute, setActiveRoute] = React.useState<string | undefined>()
  const syncActiveRoute = React.useCallback(() => {
    setActiveRoute(navigationRef.getCurrentRoute()?.name)
  }, [])

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DrillProvider>
              <ThemedBackground>
                <NavigationContainer
                  ref={navigationRef}
                  theme={NAV_THEME}
                  // Web only: a native stack keeps history in memory, which
                  // leaves the whole PWA at "/" with a Back button that exits
                  // the site. Native deep-linking is a separate decision —
                  // don't turn it on here by accident. (Join links are the one
                  // exception, handled outside React Navigation: pending-join.)
                  linking={isWeb ? webLinking : undefined}
                  documentTitle={{
                    formatter: (options) =>
                      formatDocumentTitle(options?.title, brand.displayName),
                  }}
                  onReady={() => {
                    syncActiveRoute()
                    flushPendingPush()
                    flushPendingJoin()
                  }}
                  onStateChange={syncActiveRoute}
                >
                  <RootStack activeRoute={activeRoute} />
                </NavigationContainer>
              </ThemedBackground>
            </DrillProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

export default App

const makeStyles = (theme: Theme) => StyleSheet.create({
  fill: { flex: 1 },
  // Sidebar + content side by side.
  shell: { flexDirection: "row" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  splash: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(8),
  },
  splashContent: { alignItems: "center", gap: theme.spacing(2) },
  splashTitle: {
    ...theme.typography.title,
    fontSize: 32,
    color: theme.colors.text,
  },
  splashTagline: {
    ...theme.typography.body,
    color: theme.colors.muted,
    textAlign: "center",
  },
  splashSpinner: {
    position: "absolute",
    bottom: theme.spacing(12),
  },
})
