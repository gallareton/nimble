import { expect, it, vi } from 'vitest'

it('detects Polish from the browser and translates; unknown strings fall back', async () => {
  vi.resetModules()
  Object.defineProperty(window.navigator, 'language', { value: 'pl-PL', configurable: true })
  const { t, locale } = await import('../src/i18n')
  expect(locale).toBe('pl')
  expect(t('Connect wallet')).toBe('Połącz portfel')
  expect(t('Totally unknown string')).toBe('Totally unknown string')
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})
