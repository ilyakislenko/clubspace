import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AccessExpiredScreen } from "../features/auth/AccessExpiredScreen"
import { NoWorkspaceScreen } from "../features/auth/NoWorkspaceScreen"
import { SignInScreen } from "../features/auth/SignInScreen"
import { CourseDetailScreen } from "../features/courses/CourseDetailScreen"
import { CoursesScreen } from "../features/courses/CoursesScreen"
import { ContinueWatchingScreen } from "../features/courses/ContinueWatchingScreen"
import { OfflineLibraryScreen } from "../features/offline/OfflineLibraryScreen"
import { GymsScreen } from "../features/groups/GymsScreen"
import { MyGroupsScreen } from "../features/groups/MyGroupsScreen"
import { ClubScheduleScreen } from "../features/schedule/ClubScheduleScreen"
import { EventsScreen } from "../features/schedule/EventsScreen"
import { FavoritesScreen } from "../features/profile/FavoritesScreen"
import { ProfileScreen } from "../features/profile/ProfileScreen"
import { SettingsScreen } from "../features/profile/SettingsScreen"
import { DrillModeFab, DrillProvider } from "../features/video/DrillMode"
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
import type { RootStackParamList } from "./navigation"

const Stack = createNativeStackNavigator<RootStackParamList>()

function RootStack() {
  const { ready, authed, workspace } = useAuth()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)

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

  if (authed && !workspace) {
    return <NoWorkspaceScreen />
  }

  if (authed && workspace?.accessExpired) {
    return <AccessExpiredScreen />
  }

  return (
    <View style={styles.fill}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
      {authed ? (
        <>
          <Stack.Screen
            name="Courses"
            component={CoursesScreen}
            options={{ headerShown: false }}
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
            name="Profile"
            component={ProfileScreen}
            options={{ title: "Профиль" }}
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
            name="ClubSchedule"
            component={ClubScheduleScreen}
            options={{ title: "Расписание клуба" }}
          />
          <Stack.Screen
            name="Events"
            component={EventsScreen}
            options={{ title: "Ивенты" }}
          />
        </>
      ) : (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: false }}
        />
      )}
      </Stack.Navigator>
      {authed && <DrillModeFab />}
    </View>
  )
}

export const App = () => (
  <SafeAreaProvider>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <DrillProvider>
            <NavigationContainer>
              <RootStack />
            </NavigationContainer>
          </DrillProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </SafeAreaProvider>
)

export default App

const makeStyles = (theme: Theme) => StyleSheet.create({
  fill: { flex: 1 },
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
