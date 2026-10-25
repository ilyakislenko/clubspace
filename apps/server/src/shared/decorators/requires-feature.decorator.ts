import { Reflector } from '@nestjs/core'

import type { AppFeatureKey } from '../../domains/workspace/feature-flags'

// Used by FeatureEnabledGuard. Marks a member-facing route as belonging to an
// app section a club can switch off (Workspace.<key>Enabled).
export const RequiresFeature = Reflector.createDecorator<AppFeatureKey>()
