import type { Theme } from "../shared/theme"

/** The header look shared by the root stack and the tab navigator. */
export const navHeaderOptions = (theme: Theme) => ({
  headerStyle: { backgroundColor: theme.navHeaderBg },
  headerTintColor: theme.colors.text,
  headerTitleStyle: { fontWeight: "600" as const },
})
