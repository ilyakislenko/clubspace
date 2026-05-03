import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { SignInScreen } from "../features/auth/SignInScreen"
import { CourseDetailScreen } from "../features/courses/CourseDetailScreen"
import { CoursesScreen } from "../features/courses/CoursesScreen"
import { ContinueWatchingScreen } from "../features/courses/ContinueWatchingScreen"
import { OfflineLibraryScreen } from "../features/offline/OfflineLibraryScreen"
import { FavoritesScreen } from "../features/profile/FavoritesScreen"
import { ProfileScreen } from "../features/profile/ProfileScreen"
import { SettingsScreen } from "../features/profile/SettingsScreen"
import { VideoScreen } from "../features/video/VideoScreen"
import { AuthProvider, useAuth } from "../shared/auth-context"
import { theme } from "../shared/theme"
import type { RootStackParamList } from "./navigation"

const Stack = createNativeStackNavigator<RootStackParamList>()

function RootStack() {
  const { ready, authed } = useAuth()

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    )
  }

  return (
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
        </>
      ) : (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  )
}

export const App = () => (
  <SafeAreaProvider>
    <AuthProvider>
      <NavigationContainer>
        <RootStack />
      </NavigationContainer>
    </AuthProvider>
  </SafeAreaProvider>
)

export default App

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
})
