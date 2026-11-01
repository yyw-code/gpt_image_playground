// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ siteMode: { IS_SITE_MODE: true } }))
vi.mock('../lib/siteMode', () => mocks.siteMode)
vi.mock('../lib/platform', () => ({ isTauri: false }))
import HelpModal from './HelpModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  mocks.siteMode.IS_SITE_MODE = true
})

describe('帮助页推广入口', () => {
  it.each([true, false])('站点模式 %s 保留指南，按模式显示原作者外链', (siteMode) => {
    mocks.siteMode.IS_SITE_MODE = siteMode
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(<HelpModal appMode="gallery" onClose={() => {}} />))
    expect(document.body.textContent).toContain('操作指南')
    const authorLink = document.querySelector('a[href="https://github.com/CookSleep/gpt_image_playground"]')
    if (siteMode) {
      expect(authorLink).toBeNull()
      expect(document.body.textContent).toContain('开始创作')
    } else expect(authorLink).not.toBeNull()
  })
})
