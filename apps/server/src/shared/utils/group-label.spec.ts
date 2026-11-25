import { namesGym, titleWithGym } from './group-label'

describe('namesGym', () => {
    it('finds the gym own name inside the title by whole words', () => {
        expect(namesGym('BJJ Старшие дети · Дворец спорта', 'СК «Дворец спорта»')).toBe(true)
        expect(namesGym('Йога · Южные Ворота', 'мкр. Южные Ворота')).toBe(true)
    })

    it('ignores partial words and gyms of short words only', () => {
        expect(namesGym('Дворцовая растяжка', 'СК «Дворец»')).toBe(false)
        expect(namesGym('Группа А', 'Зал «А»')).toBe(false)
    })
})

describe('titleWithGym', () => {
    it('appends the gym unless the title already names it', () => {
        expect(titleWithGym('Утренняя', 'Сибиряк')).toBe('Утренняя · Сибиряк')
        expect(titleWithGym('BJJ Взрослые · Дворец спорта', 'СК «Дворец спорта»')).toBe(
            'BJJ Взрослые · Дворец спорта',
        )
        expect(titleWithGym('Утренняя', null)).toBe('Утренняя')
    })
})
