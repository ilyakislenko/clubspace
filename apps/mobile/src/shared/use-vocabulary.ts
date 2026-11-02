import {
  vocabularyForWorkspaceType,
  type ClubVocabulary,
} from "@clubspace/ui-kit/brand"

import { useAuth } from "./auth-context"

/**
 * The current club's words for its classes and staff («тренировка / тренер»,
 * «занятие / педагог»). Switching clubs re-renders with the new club's words.
 */
export const useVocabulary = (): ClubVocabulary =>
  vocabularyForWorkspaceType(useAuth().workspace?.type)
