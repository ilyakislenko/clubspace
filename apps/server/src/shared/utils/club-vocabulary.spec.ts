// The sync check reads the client library on purpose: the server build cannot
// depend on libs/ui-kit, so this spec is the one place both copies meet.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { vocabularyForWorkspaceType as clientVocabulary } from '../../../../../libs/ui-kit/brand/vocabulary'
import {
    countNoun,
    fromFirstSession,
    loadClubVocabulary,
    vocabularyForWorkspaceType,
} from './club-vocabulary'

describe('club vocabulary', () => {
    it('speaks the same words as the apps (libs/ui-kit/brand/vocabulary)', () => {
        for (const type of ['GRAPPLING', 'FITNESS', 'YOGA', 'DANCE', 'CUSTOM', null]) {
            expect(vocabularyForWorkspaceType(type)).toEqual(clientVocabulary(type))
        }
    })

    it('keeps «тренировка / тренер» for grappling and fitness', () => {
        for (const type of ['GRAPPLING', 'FITNESS', undefined]) {
            const v = vocabularyForWorkspaceType(type)
            expect([v.session.nom, v.coach.nom]).toEqual(['тренировка', 'тренер'])
        }
    })

    it('gives a dance studio «занятие / педагог»', () => {
        const v = vocabularyForWorkspaceType('DANCE')
        expect([v.session.nom, v.coach.nom, v.headCoach.nom]).toEqual([
            'занятие',
            'педагог',
            'главный педагог',
        ])
        expect(fromFirstSession(v)).toBe('с первого занятия')
    })

    it('counts classes with the right form: 1, 2, 5, 11, 21', () => {
        const dance = vocabularyForWorkspaceType('DANCE').session
        expect([1, 2, 5, 11, 21].map((n) => countNoun(n, dance))).toEqual([
            '1 занятие',
            '2 занятия',
            '5 занятий',
            '11 занятий',
            '21 занятие',
        ])
        const sport = vocabularyForWorkspaceType('GRAPPLING').session
        expect([1, 2, 5, 11, 21].map((n) => countNoun(n, sport))).toEqual([
            '1 тренировка',
            '2 тренировки',
            '5 тренировок',
            '11 тренировок',
            '21 тренировка',
        ])
    })

    it("loads a club's words by its type, and the default for a missing club", async () => {
        const findUnique = jest
            .fn()
            .mockResolvedValueOnce({ type: 'DANCE' })
            .mockResolvedValueOnce(null)
        const prisma = { workspace: { findUnique } } as never
        expect((await loadClubVocabulary(prisma, 'w1')).coach.nom).toBe('педагог')
        expect((await loadClubVocabulary(prisma, 'gone')).coach.nom).toBe('тренер')
        expect(findUnique).toHaveBeenCalledWith({ where: { id: 'w1' }, select: { type: true } })
    })
})
