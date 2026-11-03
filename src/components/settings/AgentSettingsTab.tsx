import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type AgentApiConfigMode,
  type ApiProfile,
  type AppSettings,
} from '../../types'
import { normalizeAgentMaxToolRounds } from '../../lib/apiProfiles'
import { isPresetAgentFieldLocked } from '../../lib/presetConfig'
import { getSiteConnection } from '../../lib/siteProfiles'
import { IS_SITE_MODE } from '../../lib/siteMode'
import Select from '../Select'
import AgentProfileEditor from './AgentProfileEditor'

interface AgentSettingsTabProps {
  draft: AppSettings
  agentMaxToolRoundsInput: string
  setAgentMaxToolRoundsInput: (value: string) => void
  updateAgentApiConfigMode: (mode: AgentApiConfigMode) => void
  changeSettings: (nextDraft: AppSettings) => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
  onDeleteProfile: (profile: ApiProfile) => void
}

/** 展示 Agent 配置列表和编辑弹窗；工具行为收在高级设置，配置分别保存。 */
export default function AgentSettingsTab({
  draft,
  agentMaxToolRoundsInput,
  setAgentMaxToolRoundsInput,
  updateAgentApiConfigMode,
  changeSettings,
  commitSettings,
  onDeleteProfile,
  commitAgentMaxToolRounds,
}: AgentSettingsTabProps) {
  return (
    <div className="space-y-4">
      {IS_SITE_MODE && !getSiteConnection().baseUrl && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">本站尚未配置 API 地址，请联系站点管理员。配置可先保存，暂时无法发送请求。</p>}
      <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">这里的配置只用于 Agent，与画廊分别保存。点击“编辑”打开弹窗，点击“使用”切换配置。</p>
      <label className="block space-y-1.5 text-sm text-gray-600 dark:text-gray-300">生图方式
        <Select value={draft.agentApiConfigMode} disabled={isPresetAgentFieldLocked('apiConfigMode')} onChange={(value) => updateAgentApiConfigMode(value as AgentApiConfigMode)} options={[
          { label: '内置生图工具', value: 'native' },
          { label: '独立图片接口', value: 'hybrid' },
        ]} className="w-full rounded-xl bg-black/[0.04] px-3 py-2 text-sm dark:bg-white/[0.06]" />
      </label>
      <p className="text-xs leading-5 text-gray-500">{draft.agentApiConfigMode === 'hybrid'
        ? '对话模型调用自定义工具，再由下方 Agent 图片配置生成图片。'
        : '对话模型调用内置 image_generation 工具，需要接口和文本模型支持该工具。'}</p>
      <AgentProfileEditor draft={draft} role="text" onChange={changeSettings} onCommit={commitSettings} onDelete={onDeleteProfile} />
      {draft.agentApiConfigMode === 'hybrid' && <AgentProfileEditor draft={draft} role="image" onChange={changeSettings} onCommit={commitSettings} onDelete={onDeleteProfile} />}
      <details className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-white/[0.1] dark:bg-gray-900">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">Agent 高级设置</summary>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">最大工具调用轮数</span>
            <input
              value={agentMaxToolRoundsInput}
              onChange={(e) => setAgentMaxToolRoundsInput(e.target.value)}
              onBlur={commitAgentMaxToolRounds}
              type="number"
              min={1}
              max={50}
              className="w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
            <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
              默认 15。用于限制 Agent 连续调用工具时的最大轮数，防止无限循环。
            </div>
          </label>
          <div className="block">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="block text-sm text-gray-600 dark:text-gray-300">网络搜索</span>
              <button
                type="button"
                onClick={() => {
                  const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
                    ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
                    : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
                  setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
                  commitSettings({ ...draft, agentMaxToolRounds, agentWebSearch: !draft.agentWebSearch })
                }}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${draft.agentWebSearch ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                role="switch"
                aria-checked={draft.agentWebSearch}
                aria-label="网络搜索"
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.agentWebSearch ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
              </button>
            </div>
            <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
              启用 Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}
