import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiProfile } from '../../types'
import { DEFAULT_FAL_MODEL, DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { fetchApiModels } from '../../lib/apiModels'
import { IS_SITE_MODE } from '../../lib/siteMode'
import ModelPicker from './ModelPicker'

interface ApiModelFieldsProps {
  profile: ApiProfile
  locked: boolean
  customProviderName?: string
  onChange: (patch: Partial<ApiProfile>) => void
  onCommit: (patch: Partial<ApiProfile>) => void
}

/** 管理当前配置的模型候选和手动输入；连接变化立即隔离旧结果，取消查询不影响已存模型。 */
export default function ApiModelFields({ profile, locked, customProviderName, onChange, onCommit }: ApiModelFieldsProps) {
  // 用连接身份隔离异步结果；不把 Key 拼成 DOM 标识或写入候选缓存。
  const connection = useMemo(() => ({}), [profile.id, profile.provider, profile.baseUrl, profile.apiKey, profile.apiProxy])
  const request = useRef<AbortController | null>(null)
  const [result, setResult] = useState<{ connection: object; models: string[]; status: 'loading' | 'ready' | 'error'; error?: string } | null>(null)
  const current = result?.connection === connection ? result : null
  const models = current?.models ?? []
  const mode = profile.apiMode ?? DEFAULT_SETTINGS.apiMode
  const openai = profile.provider === 'openai'

  useEffect(() => () => request.current?.abort(), [connection])

  /** 仅在点击时读取模型，旧请求即使晚返回也不能覆盖另一套配置的候选。 */
  const refreshModels = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setResult({ connection, models: [], status: 'loading' })
    try {
      const fetched = await fetchApiModels(profile, controller.signal)
      if (!controller.signal.aborted && request.current === controller) setResult({ connection, models: fetched, status: 'ready' })
    } catch (error) {
      if (controller.signal.aborted || request.current !== controller) return
      console.warn('模型列表查询失败')
      setResult({ connection, models: [], status: 'error', error: error instanceof Error ? error.message : '模型查询失败，请重试或手动输入' })
    }
  }

  return (
    <>
      {openai && (
        <div>
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={locked || !profile.apiKey.trim() || current?.status === 'loading'}
            className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline dark:text-blue-400"
          >
            {current?.status === 'loading' ? '正在获取模型…' : current ? '刷新模型' : '获取模型'}
          </button>
          <div role="status" className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            {!profile.apiKey.trim() ? '填写个人 API Key 后可获取模型，也可直接手动输入。'
              : current?.status === 'error' ? current.error
              : current?.status === 'ready' ? models.length ? `已获取 ${models.length} 个模型。` : '接口未返回模型，可手动填写。'
              : '使用当前配置的个人 API Key 获取模型。'}
            {' '}候选列表不保证模型支持所选接口或 image_generation 工具。
          </div>
        </div>
      )}
      <div>
        {openai ? (
          <ModelPicker
            key={`model-${profile.id}`}
            label="模型 ID"
            value={profile.model}
            models={models}
            placeholder={mode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL}
            disabled={locked}
            multiple
            onChange={(model) => onChange({ model })}
            onCommit={(model) => onCommit({ model })}
          />
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">模型 ID</span>
            <input
              value={profile.model}
              onChange={(event) => onChange({ model: event.target.value })}
              onBlur={(event) => onCommit({ model: event.target.value })}
              type="text"
              disabled={locked}
              placeholder={profile.provider === 'fal' ? DEFAULT_FAL_MODEL : DEFAULT_IMAGES_MODEL}
              className="w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
          </label>
        )}
        <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
          {profile.provider === 'fal' ? (
            <>
              当前支持：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">openai/gpt-image-2</code>{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">openai/gpt-image-2.5/sunburst</code>{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">openai/gpt-image-2.5/flare</code>。
            </>
          ) : customProviderName ? (
            <>当前使用 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{customProviderName}</code>。</>
          ) : mode === 'responses' ? (
            <>Responses API 使用文本模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_RESPONSES_MODEL}</code>；原生生图还需支持 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">image_generation</code> 工具。</>
          ) : (
            <>Images API 需要使用 GPT Image 模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。</>
          )}
          多个模型以逗号分隔，可在首页的模型参数中切换。
          {!IS_SITE_MODE && openai && <>支持通过链接参数导入：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">?model=</code>。</>}
        </div>
      </div>
      {openai && mode === 'responses' && (
        <div>
          <ModelPicker
            key={`tool-${profile.id}`}
            label="图像生成模型"
            value={profile.imageGenerationModel ?? ''}
            models={models}
            placeholder="使用接口默认值"
            disabled={locked}
            allowDefault
            onChange={(imageGenerationModel) => onChange({ imageGenerationModel })}
            onCommit={(imageGenerationModel) => onCommit({ imageGenerationModel })}
          />
          <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
            Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">image_generation</code> 工具需要使用 GPT Image 模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。留空时不发送工具模型 ID，保持 API 默认值。
            {!IS_SITE_MODE && <>支持通过链接参数导入：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">?imageGenerationModel=</code>。</>}
          </div>
        </div>
      )}
    </>
  )
}
