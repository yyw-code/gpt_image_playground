// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useSketchComments } from './useSketchComments'
import { getImageCommentMention } from '../lib/promptImageMentions'

const mocks = vi.hoisted(() => ({ state: { prompt: '', inputImages: [{ id: 'reference' }], setPrompt: vi.fn(), setPromptSelection: vi.fn() } }))
vi.mock('../store', () => ({ useStore: { getState: () => mocks.state } }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
let result: ReturnType<typeof useSketchComments>
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.clearAllMocks() })

/** 挂载真实评论 hook，核对独立标注与底部提示词写入边界。 */
function Harness({ independent }: { independent: boolean }) {
  result = useSketchComments('reference', vi.fn(), independent ? [{ x: .5, y: .6, text: '独立评论' }] : undefined)
  return null
}

it('独立标注恢复、修改、保存均不写入底部或 Agent 草稿', async () => {
  mocks.state.prompt = getImageCommentMention(0, [{ x: .1, y: .2, text: '底部评论' }])
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<Harness independent />))
  expect(result.commentData).toEqual([{ x: .5, y: .6, text: '独立评论' }])
  await act(async () => result.updateComment(result.comments[0].id, { text: '新的修改要求' }))
  result.saveComments(0)
  expect(result.commentData[0].text).toBe('新的修改要求')
  expect(mocks.state.setPrompt).not.toHaveBeenCalled()
  expect(mocks.state.setPromptSelection).not.toHaveBeenCalled()
})

it('原参考图入口继续恢复并保存底部评论', async () => {
  mocks.state.prompt = getImageCommentMention(0, [{ x: .1, y: .2, text: '底部评论' }])
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<Harness independent={false} />))
  expect(result.commentData[0].text).toBe('底部评论')
  result.saveComments(0)
  expect(mocks.state.setPrompt).toHaveBeenCalled()
})
