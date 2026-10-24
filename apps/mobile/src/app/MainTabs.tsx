import Ionicons from "@expo/vector-icons/Ionicons"
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs"
import React from "react"

import { CoursesScreen } from "../features/courses/CoursesScreen"
import { HomeScreen } from "../features/home/HomeScreen"
import { ProfileScreen } from "../features/profile/ProfileScreen"
import { ProgressScreen } from "../features/progress/ProgressScreen"
import { ScheduleTabScreen } from "../features/schedule/ScheduleTabScreen"
import { useAuth } from "../shared/auth-context"
import { isFeatureEnabled } from "../shared/feature-flags"
import { isWeb } from "../shared/platform"
import { useTheme } from "../shared/theme-context"
import { useResponsive } from "../shared/useResponsive"
import { navHeaderOptions } from "./nav-header-options"
import type { MainTabParamList } from "./navigation"
import { TAB_SPECS, visibleTabs } from "./tab-routes"

const Tab = createBottomTabNavigator<MainTabParamList>()

export function MainTabs() {
  const theme = useTheme()
  const { workspace } = useAuth()
  const { isDesktop, isMobile } = useResponsive()
  const shown = new Set(
    visibleTabs((key) => isFeatureEnabled(workspace, key)).map((t) => t.name),
  )
  const options = (name: keyof MainTabParamList): BottomTabNavigationOptions => {
    const tab = TAB_SPECS.find((t) => t.name === name)!
    return {
      title: tab.label,
      headerShown: tab.header,
      tabBarIcon: ({ focused, color, size }) => (
        <Ionicons
          name={focused ? tab.iconFocused : tab.icon}
          size={size}
          color={color}
        />
      ),
    }
  }
  // The desktop sidebar lists the same destinations, so the bar would be a
  // second copy of it.
  const sidebarShown = isWeb && isDesktop

  return (
    <Tab.Navigator
      initialRouteName="Home"
      // Android back from any tab lands on Home first, then leaves the app.
      backBehavior="initialRoute"
      screenOptions={{
        ...navHeaderOptions(theme),
        // The app-wide ThemedBackground shows through; screens paint their own
        // opaque background except on the glass theme.
        sceneStyle: { backgroundColor: "transparent" },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: sidebarShown
          ? { display: "none" }
          : {
              backgroundColor: theme.navHeaderBg,
              borderTopColor: theme.colors.border,
            },
        tabBarLabelPosition: isMobile ? "below-icon" : "beside-icon",
        tabBarHideOnKeyboard: true,
      }}
    >
      {shown.has("Home") && (
        <Tab.Screen name="Home" component={HomeScreen} options={options("Home")} />
      )}
      {shown.has("Schedule") && (
        <Tab.Screen
          name="Schedule"
          component={ScheduleTabScreen}
          options={options("Schedule")}
        />
      )}
      {shown.has("Courses") && (
        <Tab.Screen
          name="Courses"
          component={CoursesScreen}
          options={options("Courses")}
        />
      )}
      {shown.has("Progress") && (
        <Tab.Screen
          name="Progress"
          component={ProgressScreen}
          options={options("Progress")}
        />
      )}
      {shown.has("Profile") && (
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={options("Profile")}
        />
      )}
    </Tab.Navigator>
  )
}
