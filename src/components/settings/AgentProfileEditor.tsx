import { useEffect, useState } from 'react'
import type { ApiProfile, AppSettings } from '../../types'
import { REASONING_EFFORT_VALUES } from '../../types'
import { createDefaultOpenAIProfile, getCustomProviderDefinition, getApiProviderLabel, isAgentTextApiProfile, splitModelList, switchApiProfileProvider } from '../../lib/apiProfiles'
import { isPresetAgentFieldLocked, isPresetConfigOnlyEnabled, isPresetConfigDeletionPrevented, isPresetProfile, isPresetProfileLocked } from '../../lib/presetConfig'
import { getSiteConnection, isSiteApiProfile } from '../../lib/siteProfiles'
import { IS_SITE_MODE } from '../../lib/siteMode'
import { isApiProxyAvailable, isApiProxyLocked } from '../../lib/devProxy'
import ApiModelFields from './ApiModelFields'
import SiteKeyPicker from './SiteKeyPicker'
import ProfileEditDialog from './ProfileEditDialog'
import Select from '../Select'

interface AgentProfileEditorProps {
  draft: AppSettings
  role: 'text' | 'image'
  onChange: (settings: AppSettings) => void
  onCommit: (settings: AppSettings) => void
  onDelete: (profile: ApiProfile) => void
}

const FIELD_CLASS = 'w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-300 disabled:opacity-60 dark:bg-white/[0.06] dark:text-gray-200'

/** 列表管理 Agent 配置，弹窗支持按名称选择本站个人密钥，显式启用才切换当前使用项。 */
export default function AgentProfileEditor({ draft, role, onChange, onCommit, onDelete }: AgentProfileEditorProps) {
  const [showKey, setShowKey] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const reference = role === 'text' ? 'agentTextProfileId' : 'agentImageProfileId'
  const label = role === 'text' ? '对话' : '图片'
  const onlyPresets = isPresetConfigOnlyEnabled()
  const selectionLocked = isPresetAgentFieldLocked(role === 'text' ? 'textProfileId' : 'imageProfileId')
  /** 仅展示当前部署允许的配置；对话入口额外限制为 Responses 文本配置。 */
  const visible = (profile: ApiProfile) => (!IS_SITE_MODE || isSiteApiProfile(profile))
    && (!onlyPresets || isPresetProfile(profile.id))
    && (role !== 'text' || isAgentTextApiProfile(profile))
  const profiles = draft.agentProfiles.filter(visible)
  const profile = profiles.find((item) => item.id === editingId)
  const locked = Boolean(profile && isPresetProfileLocked(profile.id))
  const copyOptions = draft.profiles.filter(visible)
  const models = profile ? splitModelList(profile.model) : []
  const nativeTool = role === 'image' || draft.agentApiConfigMode === 'native'

  useEffect(() => { setShowKey(false) }, [profile?.id])

  /** 只更新 Agent 池中的指定配置；失焦时持久化，编辑期间保留原始输入。 */
  const patchProfile = (patch: Partial<ApiProfile>, commit = false) => {
    if (!profile || locked && (Object.keys(patch).length !== 1 || patch.apiKey === undefined)) return
    const next = { ...draft, agentProfiles: draft.agentProfiles.map((item) => item.id === profile.id ? { ...item, ...patch } : item) }
    if (commit) onCommit(next)
    else onChange(next)
  }

  /** 新建或复制配置后打开编辑详情；保留当前使用项，副本不与画廊联动。 */
  const addProfile = (source?: ApiProfile) => {
    if (onlyPresets || selectionLocked) return
    const id = `agent-${role}-${crypto.randomUUID()}`
    const next = source
      ? { ...source, id, isDefault: undefined, name: `${source.name}（Agent 副本）` }
      : createDefaultOpenAIProfile({
          id,
          name: `Agent ${label}配置`,
          apiMode: role === 'text' ? 'responses' : 'images',
          ...(IS_SITE_MODE ? getSiteConnection() : {}),
          apiKey: '',
        })
    onCommit({ ...draft, agentProfiles: [...draft.agentProfiles, next] })
    setEditingId(id)
    setShowKey(false)
  }

  /** 完成编辑时保存尚未失焦的字段；不更改当前使用项，并恢复密钥遮挡。 */
  const closeEditor = () => {
    if (profile) onCommit({ ...draft, agentProfiles: draft.agentProfiles.map((item) => item.id === profile.id
      ? { ...item, apiKey: item.apiKey.trim(), timeout: Math.max(1, Number(item.timeout) || 300) } : item) })
    setEditingId(null)
    setShowKey(false)
  }

  return (
    <section className="space-y-4" aria-label={`Agent ${label}配置`}>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.1] dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 dark:border-white/[0.08]">
          <h4 className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}配置列表</h4>
          {!onlyPresets && !selectionLocked && <button type="button" onClick={() => addProfile()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white">新建{label}配置</button>}
        </div>
        <ul aria-label={`Agent ${label}配置列表`} className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {profiles.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
              <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-4">
                <span className="break-words text-sm font-medium text-gray-800 dark:text-gray-100">{item.name}</span>
                <span className="break-all text-xs text-gray-500">{item.selectedModel || splitModelList(item.model)[0] || '未填写模型'}</span>
              </div>
              {item.id === draft[reference] && <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">当前使用</span>}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button type="button" aria-label={`编辑 Agent ${label}配置「${item.name}」`} onClick={() => setEditingId(item.id)} className="text-blue-600 dark:text-blue-400">编辑</button>
                {item.id !== draft[reference] && <button type="button" disabled={selectionLocked} aria-label={`使用 Agent ${label}配置「${item.name}」`} onClick={() => onCommit({ ...draft, [reference]: item.id })} className="text-blue-600 disabled:opacity-50 dark:text-blue-400">使用</button>}
                {!onlyPresets && !selectionLocked && <>
                  <button type="button" aria-label={`复制 Agent ${label}配置「${item.name}」`} onClick={() => addProfile(item)} className="text-gray-500">复制</button>
                  {!(isPresetProfile(item.id) && isPresetConfigDeletionPrevented()) && <button type="button" aria-label={`删除 Agent ${label}配置「${item.name}」`} onClick={() => onDelete(item)} className="text-red-500">删除</button>}
                </>}
              </div>
            </li>
          ))}
          {!profiles.length && <li className="px-5 py-6 text-sm text-gray-500">{onlyPresets || selectionLocked ? '当前部署未提供可用配置，请联系管理员。' : `还没有${label}配置，点击上方新建。不会使用画廊的当前配置。`}</li>}
        </ul>
        {!draft[reference] && profiles.length > 0 && <p className="px-5 pb-4 text-xs text-gray-500">尚未启用{label}配置，点击列表中的“使用”后生效。</p>}
      </div>
      {!onlyPresets && !selectionLocked && copyOptions.length > 0 && (
        <div className="max-w-xs">
          <Select value="" options={[{ label: '从图片配置复制…', value: '' }, ...copyOptions.map((item) => ({ label: item.name, value: item.id }))]} onChange={(value) => {
            const source = copyOptions.find((item) => item.id === value)
            if (source) addProfile(source)
          }} className={FIELD_CLASS} />
        </div>
      )}
      {profile && <ProfileEditDialog title={`编辑 Agent ${label}配置 · ${profile.name}`} onClose={closeEditor}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {profile.id === draft[reference]
            ? <span className="text-xs text-blue-600 dark:text-blue-400">当前用于 Agent {label}</span>
            : <button type="button" disabled={selectionLocked} onClick={() => onCommit({ ...draft, [reference]: profile.id })} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">使用此{label}配置</button>}
        </div>
      <label className="block space-y-1 text-xs text-gray-500">
        配置名称
        <input
          aria-label={`Agent ${label}配置名称`}
          value={profile.name}
          disabled={locked}
          onChange={(event) => patchProfile({ name: event.target.value })}
          onBlur={(event) => patchProfile({ name: event.target.value }, true)}
          className={FIELD_CLASS}
        />
      </label>
      {role === 'image' && <label className="block space-y-1 text-xs text-gray-500">生图类型<Select value={profile.provider} disabled={locked || onlyPresets} options={[
        { label: 'OpenAI 兼容接口', value: 'openai' }, { label: 'Grok（Sub2API）', value: 'grok' },
        ...(!IS_SITE_MODE ? [{ label: 'sub2api（异步）', value: 'sb2api-async' }, { label: 'fal.ai', value: 'fal' }, ...draft.customProviders.map((provider) => ({ label: provider.name, value: provider.id }))] : []),
      ]} onChange={(value) => {
        const next = switchApiProfileProvider(profile, String(value), getCustomProviderDefinition(draft, String(value)) ?? undefined)
        patchProfile({ ...next, ...(IS_SITE_MODE ? getSiteConnection() : {}) }, true)
      }} className={FIELD_CLASS} /></label>}
      <label className="block space-y-1 text-xs text-gray-500">
        API 地址
        <input
          aria-label={`Agent ${label} API 地址`}
          value={IS_SITE_MODE ? getSiteConnection().baseUrl : profile.baseUrl}
          disabled={locked || IS_SITE_MODE}
          onChange={(event) => patchProfile({ baseUrl: event.target.value })}
          onBlur={(event) => patchProfile({ baseUrl: event.target.value }, true)}
          className={FIELD_CLASS}
        />
      </label>
      <label className="block space-y-1 text-xs text-gray-500">
        个人 API Key
        <div className="flex gap-2">
          <input
            aria-label={`Agent ${label} API Key`}
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            value={profile.apiKey}
            onChange={(event) => patchProfile({ apiKey: event.target.value })}
            onBlur={(event) => patchProfile({ apiKey: event.target.value.trim() }, true)}
            className={FIELD_CLASS}
          />
          <button type="button" onClick={() => setShowKey(!showKey)} className="shrink-0 text-xs">{showKey ? '隐藏' : '显示'}</button>
        </div>
      </label>
      <SiteKeyPicker key={profile.id} profile={profile} onSelect={(apiKey) => patchProfile({ apiKey }, true)} />
      {role === 'image' && profile.provider === 'openai' && <label className="block space-y-1 text-xs text-gray-500">生图方式<Select value={profile.apiMode} disabled={locked} options={[{ label: '直接生图（Images）', value: 'images' }, { label: '文本模型调用生图工具（Responses）', value: 'responses' }]} onChange={(value) => patchProfile({ apiMode: value as ApiProfile['apiMode'] }, true)} className={FIELD_CLASS} /></label>}
      <ApiModelFields
        profile={profile}
        locked={locked}
        purpose={role === 'text' ? 'text' : 'image'}
        showImageTool={nativeTool}
        customProviderName={profile.provider !== 'openai' ? getApiProviderLabel(draft, profile.provider) : undefined}
        onChange={patchProfile}
        onCommit={(patch) => patchProfile(patch, true)}
      />
      {models.length > 1 && <label className="block space-y-1 text-xs text-gray-500">当前{label}模型<Select value={profile.selectedModel ?? models[0]} disabled={locked} options={models.map((model) => ({ label: model, value: model }))} onChange={(value) => patchProfile({ selectedModel: String(value) }, true)} className={FIELD_CLASS} /></label>}
      {profile.apiMode === 'responses' && <label className="block space-y-1 text-xs text-gray-500">思考强度<Select value={profile.reasoningEffort ?? ''} disabled={locked} options={[{ label: '接口默认', value: '' }, ...REASONING_EFFORT_VALUES.map((value) => ({ label: value, value }))]} onChange={(value) => patchProfile({ reasoningEffort: value ? value as ApiProfile['reasoningEffort'] : undefined }, true)} className={FIELD_CLASS} /></label>}
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">高级设置</summary>
        <div className="mt-3 space-y-3">
          <label className="block space-y-1">请求超时（秒）<input aria-label={`Agent ${label}超时`} type="number" min={1} value={profile.timeout} disabled={locked} onChange={(event) => patchProfile({ timeout: Number(event.target.value) })} onBlur={(event) => patchProfile({ timeout: Math.max(1, Number(event.target.value) || 300) }, true)} className={FIELD_CLASS} /></label>
          {profile.provider === 'openai' && <>
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(profile.streamImages)} disabled={locked} onChange={(event) => patchProfile({ streamImages: event.target.checked }, true)} />流式图片输出</label>
            {profile.streamImages && <label className="block space-y-1">中间预览图数量<input type="number" min={0} max={3} value={profile.streamPartialImages ?? 1} disabled={locked} onChange={(event) => patchProfile({ streamPartialImages: Number(event.target.value) }, true)} className={FIELD_CLASS} /></label>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={profile.codexCli} disabled={locked} onChange={(event) => patchProfile({ codexCli: event.target.checked }, true)} />Codex CLI 兼容模式</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(profile.responseFormatB64Json)} disabled={locked} onChange={(event) => patchProfile({ responseFormatB64Json: event.target.checked }, true)} />请求 Base64 图片响应</label>
            {!IS_SITE_MODE && isApiProxyAvailable() && <label className="flex items-center gap-2"><input type="checkbox" checked={profile.apiProxy || isApiProxyLocked()} disabled={locked || isApiProxyLocked()} onChange={(event) => patchProfile({ apiProxy: event.target.checked }, true)} />使用 API 代理</label>}
            <label className="block space-y-1">透明背景处理<Select value={profile.transparentBackgroundMethod} disabled={locked} options={[{ label: '接口原生', value: 'api' }, { label: '本地处理', value: 'local' }]} onChange={(value) => patchProfile({ transparentBackgroundMethod: value as ApiProfile['transparentBackgroundMethod'] }, true)} className={FIELD_CLASS} /></label>
          </>}
        </div>
      </details>
      {!onlyPresets && !selectionLocked && <div className="flex gap-4 text-xs"><button type="button" onClick={() => addProfile(profile)} className="text-blue-600 dark:text-blue-400">复制为新配置</button>{!(isPresetProfile(profile.id) && isPresetConfigDeletionPrevented()) && <button type="button" onClick={() => onDelete(profile)} className="text-red-500">删除此 Agent 配置</button>}</div>}
      </ProfileEditDialog>}
    </section>
  )
}
