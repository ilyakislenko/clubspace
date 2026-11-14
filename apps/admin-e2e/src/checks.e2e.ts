import { expect, test } from '@playwright/test'

import { ACCESS_DENIED_TEXT, LOADER_TEXT, findBadText, isExpected4xx } from './checks'

// The page checks themselves: a check that never fires, or fires on normal
// copy, makes the smoke suite worthless either way.

test('value leaks are found with context; ordinary words are not', () => {
  expect(findBadText('Оплачено до Invalid Date')).toEqual(['«Оплачено до Invalid Date»'])
  expect(findBadText('Посещаемость NaN% · тренер undefined')).toHaveLength(2)
  expect(findBadText('Имя: [object Object]')).toHaveLength(1)
  expect(findBadText('Undefinedness, NaNa, banana, null, 0 занятий')).toEqual([])
})

test('loader texts match whole placeholder lines only', () => {
  for (const text of ['Загрузка…', 'Загрузка...', 'Загружаем…', 'Загружаем расшифровку…', 'Проверяем сессию…']) {
    expect(text).toMatch(LOADER_TEXT)
  }
  // Report and sheet titles that merely start with the word.
  for (const text of ['Загружено', 'Загрузка отменена', 'Загрузка расписания', 'Загрузка видео', 'Проверяем файл…']) {
    expect(text).not.toMatch(LOADER_TEXT)
  }
})

test('only a 403 on a route the role must not open is an expected 4xx', () => {
  const api = 'http://localhost:3000/workspaces/w1'
  expect(isExpected4xx(403, 'blocked', `${api}/payments`)).toBe(true)
  expect(isExpected4xx(403, 'page', `${api}/payments`)).toBe(false)
  expect(isExpected4xx(404, 'blocked', `${api}/payments`)).toBe(false)
  expect(isExpected4xx(401, 'page', `${api}/stats`)).toBe(false)
})

test('the access-denied notice of gated sections counts as blocked', () => {
  expect('Раздел доступен только администратору клуба').toMatch(ACCESS_DENIED_TEXT)
  expect('Раздел доступен администратору клуба и руководителям направлений').toMatch(ACCESS_DENIED_TEXT)
})
