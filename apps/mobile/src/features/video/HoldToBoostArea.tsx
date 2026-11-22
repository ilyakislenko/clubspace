import React, { type ReactNode } from "react"
import { View, type StyleProp, type ViewStyle } from "react-native"

import { BoostBadge } from "./BoostBadge"
import type { PlayerHandle } from "./player-types"
import { usePlayerGestures } from "./use-player-gestures"

type Props = {
  player: PlayerHandle
  style: StyleProp<ViewStyle>
  children: ReactNode
}

// The player container for a surface with built-in controls (Plyr on web):
// it only *observes* touches for hold → 2x and leaves every tap to Plyr.
// Native draws its own controls instead (PlayerOverlay).
export function HoldToBoostArea({ player, style, children }: Props) {
  const { boosted, passiveHoldProps } = usePlayerGestures({ player })
  return (
    <View style={style} {...passiveHoldProps}>
      {children}
      {boosted && <BoostBadge />}
    </View>
  )
}
