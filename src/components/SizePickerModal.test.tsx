// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SizePickerModal from './SizePickerModal'

describe('model-aware size picker', () => {
  it.each([['9:16', '864x1536', '9:16'], ['自动', 'auto', 'auto']])('从横图切换为 %s 时同时更新目标比例和建议尺寸', (label, size, ratio) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1536x864" imageAspectRatio="16:9" ratioOnly onSelect={onSelect} onClose={vi.fn()} />))
      const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!
      act(() => button(label).click())
      act(() => button('确定').click())
      expect(onSelect).toHaveBeenCalledWith(size, ratio)
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('站点比例模式隐藏像素档位并准确提交目标比例，重新打开不出现约等号', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1280x544" imageAspectRatio="21:9" ratioOnly onSelect={onSelect} onClose={vi.fn()} />))
      expect(container.textContent).not.toContain('基准分辨率')
      expect(container.textContent).not.toContain('4K')
      expect(container.textContent).not.toContain('自定义宽高')
      expect(container.textContent).not.toContain('≈')
      act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '确定')!.click())
      expect(onSelect).toHaveBeenCalledWith(expect.any(String), '21:9')
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('兼容模式不再引导用户关闭 CLI 选择不可兑现的分辨率', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    const onOpenSettings = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1920x816" codexCli onSelect={onSelect} onClose={vi.fn()} onOpenSettings={onOpenSettings} />))
      expect(container.textContent).toContain('实际分辨率由模型决定')
      expect(container.textContent).not.toContain('前往配置设置')
      expect(onOpenSettings).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('原生模式允许选择分辨率和自定义尺寸，确认时返回所选像素', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1024x1024" sizeMode="custom" onSelect={onSelect} onClose={vi.fn()} />))
      const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
      expect(button('自定义宽高').disabled).toBe(false)
      expect(button('4K').disabled).toBe(false)
      act(() => button('2K').click())
      act(() => button('确定').click())
      expect(onSelect).toHaveBeenCalledWith('2048x2048')
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('offers fixed 1.5 sizes while retaining disabled custom controls', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="1024x1024" sizeMode="fixed" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('1536x1024')
    expect(html).toContain('1024x1536')
    expect(html).toContain('4K')
    expect(html).toContain('自定义宽高')
  })

  it('shows only composition controls for a Codex connection', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="1280x720" codexCli onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('设置图像比例')
    expect(html).toContain('16:9')
    expect(html).not.toContain('1280x720')
    expect(html).not.toContain('基准分辨率')
    expect(html).not.toContain('自定义宽高')
    expect(html).not.toContain('4K')
    expect(html).toContain('偏差超过 1% 时标黄提示')
  })

  it.each(['fixed', 'auto'] as const)('禁用 %s 的自定义宽高和档位，点击不会改变确认结果', (sizeMode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1024x1024" sizeMode={sizeMode} onSelect={onSelect} onClose={vi.fn()} />))
      for (const label of ['自定义宽高', '1K', '2K', '4K']) {
        const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
        expect(button.disabled).toBe(true)
        act(() => button.click())
      }
      const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === '确定')!
      act(() => confirm.click())
      expect(onSelect).toHaveBeenCalledWith(sizeMode === 'auto' ? 'auto' : '1024x1024')
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('keeps custom native sizes and labels experimental resolution', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="3840x2160" sizeMode="custom" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('3840x2160')
    expect(html).toContain('自定义宽高')
    expect(html).toContain('实验支持')
  })

  it('retains a non-preset Codex composition when confirming the reopened picker', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSelect = vi.fn()
    const onClose = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1152x960" sizeMode="composition" onSelect={onSelect} onClose={onClose} />))
      expect(container.querySelector('input')?.value).toBe('6:5')
      const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === '确定')!
      act(() => confirm.click())
      const [width, height] = onSelect.mock.calls[0][0].split('x').map(Number)
      expect(Math.abs((width / height) / (1152 / 960) - 1)).toBeLessThanOrEqual(0.01)
      expect(onSelect.mock.calls[0][1]).toBe('6:5')
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})

describe('Grok 原生尺寸选择', () => {
  it('允许弹窗内滚轮和触摸滚动，在边界和弹窗外阻止背景滚动', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      act(() => root.render(<SizePickerModal currentSize="auto" sizeMode="grok" grokModel="grok-imagine-image-2.0" grokAspectRatio="21:9" onSelect={vi.fn()} onClose={vi.fn()} />))
      const scroll = container.querySelector<HTMLElement>('[aria-label="尺寸选项"]')!
      // jsdom 不计算布局，提供真实溢出条件以验证全局事件是否错误拦截。
      scroll.style.overflowY = 'auto'
      Object.defineProperties(scroll, { scrollHeight: { value: 600 }, clientHeight: { value: 380 } })
      const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
      scroll.querySelector('button')!.dispatchEvent(wheel)
      expect(wheel.defaultPrevented).toBe(false)
      scroll.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 150 } as Touch], bubbles: true }))
      const touch = new TouchEvent('touchmove', { touches: [{ clientX: 20, clientY: 80 } as Touch], bubbles: true, cancelable: true })
      scroll.dispatchEvent(touch)
      expect(touch.defaultPrevented).toBe(false)
      scroll.scrollTop = 220
      const bottom = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
      scroll.dispatchEvent(bottom)
      expect(bottom.defaultPrevented).toBe(true)
      const outside = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
      document.body.dispatchEvent(outside)
      expect(outside.defaultPrevented).toBe(true)
    } finally { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() }
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('保留 2K 和原生比例，禁用 4K/自定义像素及旧模型不支持的比例', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onGrokSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="auto" sizeMode="grok" grokModel="grok-imagine-image" grokResolution="2k" grokAspectRatio="16:9" onGrokSelect={onGrokSelect} onSelect={vi.fn()} onClose={vi.fn()} />))
      const button = (label: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)!
      expect(button('4K').disabled).toBe(true)
      expect(button('2K').disabled).toBe(false)
      expect(button('自定义宽高').disabled).toBe(true)
      expect(button('21:9').disabled).toBe(true)
      act(() => button('9:16').click())
      act(() => button('确定').click())
      expect(onGrokSelect).toHaveBeenCalledWith({ resolution: '2k', aspect_ratio: '9:16' })
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })
})
