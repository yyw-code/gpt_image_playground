import { describe, expect, it } from 'vitest'
import { appendImageAspectRatioPrompt, calculateImageSize, getImageAspectRatioInstruction, getImageAspectRatioWarning, isExperimentalImageSize, normalizeCodexCliImageSize, normalizeModelImageSize, prependCodexCliSizePrompt, stripInjectedCodexCliSizePrompt, stripInjectedImageAspectRatioPrompt } from './size'

describe('model size contracts', () => {
  it('keeps only fixed native sizes for 1.5 and preserves auto', () => {
    expect(normalizeModelImageSize('1536x1024', 'fixed')).toBe('1536x1024')
    expect(normalizeModelImageSize('3840x2160', 'fixed')).toBe('auto')
    expect(normalizeModelImageSize('auto', 'fixed')).toBe('auto')
  })

  it.each(['3840x1648', '1024x1024', '3840x2160'])('preserves valid custom dimensions %s', (size) => {
    expect(normalizeModelImageSize(size, 'custom')).toBe(size)
  })

  it.each(['100x100', '8000x1000', '20000x20000', '1025x1025'])('normalizes geometry at the native boundary for %s', (size) => {
    const [width, height] = normalizeModelImageSize(size, 'custom').split('x').map(Number)
    expect(width % 16).toBe(0)
    expect(height % 16).toBe(0)
    expect(Math.max(width, height)).toBeLessThanOrEqual(3840)
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3)
    expect(width * height).toBeGreaterThanOrEqual(655360)
    expect(width * height).toBeLessThanOrEqual(8294400)
  })

  it('marks experimental resolution without treating it as invalid', () => {
    expect(isExperimentalImageSize('2560x1440')).toBe(false)
    expect(isExperimentalImageSize('3840x1648')).toBe(true)
    expect(isExperimentalImageSize('auto')).toBe(false)
  })

  it.each(['0x1024', 'invalid', `${'9'.repeat(310)}x1024`])('falls back to auto for invalid dimensions %s', (size) => {
    expect(normalizeModelImageSize(size, 'custom')).toBe('auto')
    expect(normalizeModelImageSize(size, 'composition')).toBe('auto')
  })
})

describe('image aspect ratio compatibility', () => {
  it.each([
    ['3840x2160', '16:9', 'landscape'],
    ['1024x1824', '9:16', 'portrait'],
    ['2016x864', '21:9', 'landscape'],
    ['1254x1254', '1:1', 'square'],
    ['1600x960', '5:3', 'landscape'],
  ])('describes the requested composition for %s', (size, ratio, orientation) => {
    expect(getImageAspectRatioInstruction(size)).toBe(`Composition: ${ratio} aspect ratio, ${orientation} canvas.`)
  })

  it.each(['auto', '', 'unknown', '0x1024', '-1x1024', 'Infinityx1024', '9007199254740992x1024'])('ignores invalid or automatic size %s', (size) => {
    expect(getImageAspectRatioInstruction(size)).toBe('')
    expect(appendImageAspectRatioPrompt('Draw a cat.', size)).toBe('Draw a cat.')
  })

  it('appends a composition once without mutating the user prompt', () => {
    const original = 'Draw a cat.\n'
    const expected = 'Draw a cat.\n\nComposition: 21:9 aspect ratio, landscape canvas.'
    expect(appendImageAspectRatioPrompt(original, '2016x864')).toBe(expected)
    expect(appendImageAspectRatioPrompt(expected, '2016x864')).toBe(expected)
    expect(stripInjectedImageAspectRatioPrompt(expected, original, '2016x864')).toBe(original)
  })

  it('preserves user-written composition and unrelated rewrites', () => {
    const original = 'Draw a cat.\n\nComposition: 1:1 aspect ratio, square canvas.'
    expect(stripInjectedImageAspectRatioPrompt(original, original, '1024x1024')).toBe(original)
    expect(stripInjectedImageAspectRatioPrompt('A different scene.', 'Draw a cat.', '1024x1024')).toBe('A different scene.')
    expect(stripInjectedImageAspectRatioPrompt('A revised cat.\n\nComposition: 1:1 aspect ratio, square canvas.', 'Draw a cat.', '1024x1024')).toBe('A revised cat.')
  })

  it('accepts small pixel differences and detects an incorrect canvas orientation', () => {
    expect(getImageAspectRatioWarning('2016x864', '1915×821')).toBe('')
    expect(getImageAspectRatioWarning('3840x2160', '1672x940')).toBe('')
    expect(getImageAspectRatioWarning('1440x2560', '1672×941')).toContain('比例与请求不符')
    expect(getImageAspectRatioWarning('auto', '1254x1254')).toBe('')
    expect(getImageAspectRatioWarning('1024x1024', '')).toBe('')
    expect(getImageAspectRatioWarning('1024x1024', '0x1024')).toBe('')
  })
})

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })
})

describe('Codex CLI size compatibility', () => {
  it('normalizes custom sizes to the 1K pixel budget', () => {
    expect(normalizeCodexCliImageSize('2048x2048')).toBe('1024x1024')
    expect(normalizeCodexCliImageSize('2048x1536')).toBe('1024x768')
    expect(normalizeCodexCliImageSize('1536x1024')).toBe('1536x1024')
  })

  it('preserves non-preset ratios approximately and clamps excessive ratios', () => {
    expect(normalizeCodexCliImageSize('2500x2000')).toBe(calculateImageSize('1K', '5:4'))
    const [width, height] = normalizeCodexCliImageSize('4000x1000').split('x').map(Number)
    expect(width / height).toBeCloseTo(3, 2)
    expect(width * height).toBeLessThanOrEqual(1_572_864)
  })

  it('prepends a concise resolution hint only for explicit sizes', () => {
    expect(prependCodexCliSizePrompt('Draw a cat.\n', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.\n')
    expect(prependCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(prependCodexCliSizePrompt('Draw a cat.', 'auto')).toBe('Draw a cat.')
  })

  it('strips only the matching injected resolution hint', () => {
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 2048x2048 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Generate at 2048x2048 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', 'auto')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
  })
})
