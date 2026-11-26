import {
    type CompetitorSex,
    divisionName,
    kgToGrams,
    levelRangeLabel,
} from '../../../domains/tournaments/divisions'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'

export type DivisionCriteriaInput = {
    sex?: CompetitorSex | null
    ageMin?: number | null
    ageMax?: number | null
    templateId?: string | null
    levelOrderFrom?: number | null
    levelOrderTo?: number | null
    weightMinKg?: number | null
    weightMaxKg?: number | null
}

export type DivisionCriteriaData = {
    sex: CompetitorSex | null
    ageMin: number | null
    ageMax: number | null
    templateId: string | null
    levelOrderFrom: number | null
    levelOrderTo: number | null
    levelLabel: string | null
    weightMinG: number | null
    weightMaxG: number | null
}

// The levels of the org's standards named by `templateIds` (another org's
// template → 400).
export const loadTemplateLevels = async (
    prisma: Pick<PrismaService, 'organizationLadderTemplate'>,
    organizationId: string,
    templateIds: string[],
): Promise<Map<string, Array<{ order: number; name: string }>>> => {
    const ids = [...new Set(templateIds)]
    if (ids.length === 0) return new Map()
    const templates = await prisma.organizationLadderTemplate.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true, levels: { select: { order: true, name: true } } },
    })
    if (templates.length !== ids.length) {
        throw new BadRequestError({ message: 'Стандарт не найден в этой федерации' })
    }
    return new Map(templates.map((t) => [t.id, t.levels]))
}

// Checks the bounds and builds the stored criteria with the level label.
export const resolveCriteria = (
    c: Required<DivisionCriteriaInput>,
    levels: Map<string, Array<{ order: number; name: string }>>,
): DivisionCriteriaData => {
    if (c.ageMin !== null && c.ageMax !== null && c.ageMin > c.ageMax) {
        throw new BadRequestError({ message: 'Возраст «от» больше, чем «до»' })
    }
    const weightMinG = c.weightMinKg === null ? null : kgToGrams(c.weightMinKg)
    const weightMaxG = c.weightMaxKg === null ? null : kgToGrams(c.weightMaxKg)
    if (weightMinG !== null && weightMaxG !== null && weightMinG >= weightMaxG) {
        throw new BadRequestError({ message: 'Нижняя граница веса должна быть меньше верхней' })
    }
    const ranged = c.levelOrderFrom !== null || c.levelOrderTo !== null
    if (ranged && c.templateId === null) {
        throw new BadRequestError({ message: 'Для диапазона уровней выберите стандарт федерации' })
    }
    if (c.levelOrderFrom !== null && c.levelOrderTo !== null && c.levelOrderFrom > c.levelOrderTo) {
        throw new BadRequestError({ message: 'Уровень «от» выше, чем «до»' })
    }
    const levelLabel = c.templateId
        ? levelRangeLabel(levels.get(c.templateId) ?? [], c.levelOrderFrom, c.levelOrderTo)
        : null
    return {
        sex: c.sex,
        ageMin: c.ageMin,
        ageMax: c.ageMax,
        templateId: c.templateId,
        levelOrderFrom: c.levelOrderFrom,
        levelOrderTo: c.levelOrderTo,
        levelLabel: levelLabel?.slice(0, 120) ?? null,
        weightMinG,
        weightMaxG,
    }
}

export const generatedName = (d: DivisionCriteriaData): string => divisionName(d, d.levelLabel)
