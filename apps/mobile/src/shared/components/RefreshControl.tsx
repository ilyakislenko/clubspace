export { RefreshControl } from "react-native"

/**
 * The app's RefreshControl. Import this instead of react-native's — an eslint
 * rule enforces it (see eslint.config.mjs).
 *
 * On native it *is* React Native's, re-exported unchanged. The web build gets
 * `RefreshControl.web.tsx`, which implements the pull gesture by hand:
 * react-native-web's own RefreshControl throws away every prop it's given
 * (`onRefresh` included) and renders a bare View, so pull-to-refresh silently
 * did nothing in a browser on all 14 list screens.
 */
