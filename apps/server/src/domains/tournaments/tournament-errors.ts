// Typed 409s of federation tournaments (design
// docs/design/2026-11-27-tournaments.md §5.3). STALE_UPDATE and
// ORG_CONSENT_REQUIRED are reused from shared/errors and consent.ts.
import { DefaultError } from '../../shared/errors/default.error'
import { pluralRu } from '../../shared/utils/plural-ru'

export class TournamentLockedError extends DefaultError {
    constructor() {
        super({
            message: 'Заявки закрыты — изменения через секретаря турнира',
            code: 'TOURNAMENT_LOCKED',
            statusCode: 409,
        })
    }
}

export class DivisionHasResultsError extends DefaultError {
    constructor(message = 'В категории уже есть результаты') {
        super({ message, code: 'DIVISION_HAS_RESULTS', statusCode: 409 })
    }
}

export class MatchUndoBlockedError extends DefaultError {
    constructor(message: string) {
        super({ message, code: 'MATCH_UNDO_BLOCKED', statusCode: 409 })
    }
}

export class TournamentPublishedError extends DefaultError {
    constructor() {
        super({
            message: 'Итоги опубликованы — сначала снимите публикацию',
            code: 'TOURNAMENT_PUBLISHED',
            statusCode: 409,
        })
    }
}

export class TournamentUnassignedError extends DefaultError {
    constructor(count: number) {
        super({
            message: `${count} ${pluralRu(count, 'участник', 'участника', 'участников')} без категории`,
            code: 'TOURNAMENT_UNASSIGNED',
            statusCode: 409,
            metadata: { count },
        })
    }
}

export class TournamentStartedError extends DefaultError {
    constructor() {
        super({
            message: 'Турнир уже идёт — событие нельзя удалить',
            code: 'TOURNAMENT_STARTED',
            statusCode: 409,
        })
    }
}
