import { useEffect, useRef, useState } from 'react'
import type { ApiProfile, ImageRegenerationDraft, TaskParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getTaskApiProfile, stopBatchPrompts, submitImageRegeneration, useStore } from '../store'
import { getApiProviderLabel, getTaskApiConfigScope, normalizeSettings, resolveApiProfileModel, splitModelList } from '../lib/apiProfiles'
import { cacheImage, ensureImageCached } from '../lib/imageCache'
import { hashDataUrl } from '../lib/db'
import { getImageRegenerationTargets } from '../lib/imageRegeneration'
import { getImageOutputIssues, getImageParameterCapabilities, usesImageAspectRatio } from '../lib/imageModels'
import { getOutputImageLimitForSettings } from '../lib/paramCompatibility'
import { getTaskPromptText } from '../lib/promptImageMentions'
import { getRequestedImageAspectRatio } from '../lib/size'
import { isSiteApiProfile } from '../lib/siteProfiles'
import { IS_SITE_MODE } from '../lib/siteMode'
import { isPresetConfigOnlyEnabled, isPresetConfigParamsLocked, isPresetProfile } from '../lib/presetConfig'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, EditIcon } from './icons'
import SizePickerModal from './SizePickerModal'
import Select from './Select'

const FIELD_CLASS = 'w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100'
const BUTTON_CLASS = 'rounded-xl px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40'

/** 根据独立草稿挂载面板；每次打开使用新实例，取消不写回全局输入。 */
export default function ImageRegenerationModal() {
  const draft = useStore((state) => state.imageRegeneration)
  return draft ? <RegenerationEditor initialDraft={draft} /> : null
}

/** 直接编辑单图或批量生成要求，复用尺寸选择器、参数能力和现有请求队列。 */
function RegenerationEditor({ initialDraft }: { initialDraft: ImageRegenerationDraft }) {
  const draft = useStore((state) => state.imageRegeneration)!
  const tasks = useStore((state) => state.tasks)
  const settings = useStore((state) => state.settings)
  const setDraft = useStore((state) => state.setImageRegeneration)
  const setSketchBoard = useStore((state) => state.setSketchBoard)
  const sketchBoard = useStore((state) => state.sketchBoard)
  const batchProgress = useStore((state) => state.batchProgress)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const [images, setImages] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [countInput, setCountInput] = useState(String(initialDraft.count))
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const submittingRef = useRef(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [availableTargets] = useState(() => {
    const ids = new Set(initialDraft.targets.map((target) => target.taskId))
    return getImageRegenerationTargets(tasks.filter((task) => ids.has(task.id)))
  })
  const source = tasks.find((task) => task.id === (draft.targets[previewIndex]?.taskId ?? draft.targets[0]?.taskId))
  const target = draft.targets[previewIndex] ?? draft.targets[0]
  const batch = draft.targets.length > 1
  const normalizedSettings = normalizeSettings(settings)
  const sourceProfile = source ? getTaskApiProfile(settings, source, true) : null
  const profiles = [
    ...normalizedSettings.profiles.map((profile) => ({ profile, scope: 'gallery' as const })),
    ...(sourceProfile && source && getTaskApiConfigScope(source) === 'agent' ? [{ profile: sourceProfile, scope: 'agent' as const }] : []),
  ].filter(({ profile }) => (!IS_SITE_MODE || isSiteApiProfile(profile)) && (!isPresetConfigOnlyEnabled() || isPresetProfile(profile.id)))
  const selectedProfile = draft.profile ? profiles.find((entry) => entry.profile.id === draft.profile!.id && entry.scope === draft.profile!.scope) : null
  const profile: ApiProfile | null = draft.profile ? selectedProfile ? { ...selectedProfile.profile, model: draft.profile.model } : null : sourceProfile
  const params = draft.params ?? source?.params ?? DEFAULT_PARAMS
  const capabilities = profile ? getImageParameterCapabilities(profile) : null
  const ratioOnly = profile ? usesImageAspectRatio(profile) : false
  const outputIssues = profile ? Object.values(getImageOutputIssues(params, profile)) : []
  // 总数和所有来源通道共同约束数量，预览切换不能绕过另一张源图的限制。
  const countLimit = Math.min(Math.floor(10 / Math.max(1, draft.targets.length)), ...draft.targets.map((target) => {
    const task = tasks.find((task) => task.id === target.taskId)
    const targetProfile = draft.profile ? profile : task ? getTaskApiProfile(settings, task, true) : null
    return targetProfile ? getOutputImageLimitForSettings({ ...normalizedSettings, profiles: [targetProfile], activeProfileId: targetProfile.id }) : 10
  }))
  const countError = countLimit < 1 ? '一次最多选择 10 张源图，请取消多余选择。'
    : !countInput || !Number.isInteger(draft.count) || draft.count < 1 || draft.count > countLimit
      ? `请输入 1–${countLimit} 的整数，每张最多 ${countLimit} 张。` : ''
  const locked = isPresetConfigParamsLocked()
  const paramsDisabled = submitting || locked || !profile || batch && !draft.params
  const annotationDisabled = batch || !target || draft.mode !== 'edit' || submitting
  const sourceImage = target ? images[target.imageId] : ''
  const previewImage = !batch && draft.annotation ? draft.annotation.image.dataUrl : sourceImage

  /** 只更新独立草稿并记录未保存变更，避免影响底部参数及配置。 */
  function update(patch: Partial<ImageRegenerationDraft>) {
    if (submittingRef.current) return
    setDraft({ ...draft, ...patch })
    setDirty(true)
    setError('')
  }

  /** 数量允许暂时留空；只接收十进制整数，去除前导零并将用户输入限制在当前上限内。 */
  function updateCount(value: string) {
    if (locked || submittingRef.current || !/^\d*$/.test(value)) return
    if (!value) {
      setCountInput('')
      setDirty(true)
      setError('')
      return
    }
    const count = Math.min(Math.max(1, countLimit), Math.max(1, Number(value)))
    setCountInput(String(count))
    update({ count })
  }

  /** 参数遵循现有预置锁定策略，不自动清洗旧值，用户明确调整后再写入草稿。 */
  function updateParams(patch: Partial<TaskParams>) {
    if (locked || submittingRef.current) return
    update({ params: { ...params, ...patch, n: draft.count } })
  }

  /** 有变更时沿用确认弹窗；生成过程中可停止剩余任务，不能把关闭视为取消已发送请求。 */
  function close() {
    if (submittingRef.current) return
    if (!dirty) { setDraft(null); return }
    setConfirmDialog({ title: '放弃本次修改？', message: '本次提示词、参数与标注尚未提交，原图保持不变。', confirmText: '放弃修改', action: () => setDraft(null) })
  }

  usePreventBackgroundScroll(true, modalRef)
  useCloseOnEscape(!sketchBoard && !showSizePicker, close)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    let cancelled = false
    void Promise.all([...new Set(availableTargets.map((item) => item.imageId))].map(async (imageId) => [imageId, await ensureImageCached(imageId)] as const)).then((items) => {
      if (!cancelled) setImages(Object.fromEntries(items.filter((item): item is readonly [string, string] => Boolean(item[1]))))
    }).catch(() => { if (!cancelled) setError('读取来源图片失败，请关闭后重试') })
    return () => { cancelled = true }
  }, [availableTargets])

  /** 打开原画板，导出的笔迹图及位置评论只保存至本次面板，不写底部输入或图片数据库。 */
  async function openBoard() {
    if (annotationDisabled || !previewImage) return
    setSketchBoard({
      baseImageSrc: previewImage, comments: draft.annotation?.comments ?? [], layout: draft.annotation?.layout,
      onConfirm: async (dataUrl, comments, layout) => {
        const id = await hashDataUrl(dataUrl)
        cacheImage(id, dataUrl)
        const latest = useStore.getState().imageRegeneration
        if (!latest || latest.targets.length !== 1 || latest.mode !== 'edit') return
        setDraft({ ...latest, annotation: { image: { id, dataUrl }, comments, layout } })
        setDirty(true)
      },
    })
  }

  /** 数量无效时不提交；两种操作唯一确定提示词组合：修改只用本次要求，重生成沿用原要求并追加输入；store 校验失败时保留草稿。 */
  async function submit() {
    if (submittingRef.current || countError) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const ids = await submitImageRegeneration({ ...draft, promptMode: draft.mode === 'edit' ? 'replace' : 'append' })
      setDraft(null)
      if (ids[0]) setDetailTaskId(ids[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  /** 选图按请求位置匹配；变为多张时丢弃单图标注，不把它套用到其他图片。 */
  function toggleTarget(item: typeof availableTargets[number]) {
    const selected = draft.targets.some((target) => target.taskId === item.taskId && target.requestIndex === item.requestIndex)
    const targets = selected ? draft.targets.filter((target) => target.taskId !== item.taskId || target.requestIndex !== item.requestIndex) : [...draft.targets, item]
    update({ targets, annotation: undefined })
    setPreviewIndex(0)
  }

  return <>
    <div data-no-drag-select className="fixed inset-0 z-[65] flex items-center justify-center bg-black/20 backdrop-blur-md dark:bg-black/40 sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={modalRef} role="dialog" aria-modal={!sketchBoard && !showSizePicker} aria-labelledby="image-regeneration-title" className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:max-h-[92dvh] sm:rounded-3xl sm:border sm:border-gray-200 dark:sm:border-white/[0.08]" onKeyDown={(event) => {
        if (event.key !== 'Tab' || sketchBoard || showSizePicker) return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), summary')].filter((el) => el.offsetParent !== null)
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
        <header className="flex items-start justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08] sm:px-6">
          <div><h2 id="image-regeneration-title" className="font-semibold text-gray-800 dark:text-gray-100">{batch ? '批量重新生成' : '重新生成'}</h2><p className="mt-1 text-xs text-gray-500">{target ? `第 ${target.requestIndex + 1} 张 · ${draft.targets.length} 张源图` : '请选择图片'}{source?.sourceMode === 'agent' ? ' · 将创建画廊版本，保留 Agent 对话' : ''}</p></div>
          <button ref={closeRef} aria-label="关闭重生成面板" disabled={submitting} onClick={close} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-white/[0.06]"><CloseIcon className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid md:grid-cols-2">
            <section aria-label="来源图片" className="flex min-w-0 flex-col border-b border-gray-100 p-5 dark:border-white/[0.08] md:border-b-0 md:border-r sm:p-6">
              <div className="relative flex aspect-[3/2] items-center justify-center overflow-hidden rounded-2xl bg-gray-100 dark:bg-black/20">
                {previewImage ? <img src={previewImage} alt={`第 ${(target?.requestIndex ?? 0) + 1} 张源图`} className="h-full w-full object-contain" /> : <p className="text-sm text-gray-500">{target ? '来源图片读取中或已不存在' : '尚未选择图片'}</p>}
                {draft.annotation && !batch && <span className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs text-white">已添加标注 · {draft.annotation.comments.length} 条位置评论</span>}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500"><span>勾选要重新生成的图片</span><span>{draft.targets.length} / {availableTargets.length} 张</span></div>
              <div className="mt-3 grid grid-cols-6 gap-2">
                {availableTargets.map((item, index) => {
                  const selected = draft.targets.some((target) => target.taskId === item.taskId && target.requestIndex === item.requestIndex)
                  return <button key={`${item.taskId}:${item.requestIndex}`} type="button" aria-label={`选择第 ${index + 1} 张源图`} aria-pressed={selected} disabled={submitting} onClick={() => toggleTarget(item)} className={`relative aspect-square overflow-hidden rounded-lg border-2 disabled:opacity-50 ${selected ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-transparent opacity-60'}`}>
                    {images[item.imageId] && <img src={images[item.imageId]} alt="" className="h-full w-full object-cover" />}
                    <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white">{item.requestIndex + 1}</span>
                    {selected && <span className="absolute right-0 top-0 rounded-bl bg-blue-500 px-1 text-[10px] text-white">✓</span>}
                  </button>
                })}
              </div>
              {batch && <div className="mt-3 text-xs text-gray-500">预览来源<Select ariaLabel="预览来源图片" disabled={submitting} className={`${FIELD_CLASS} mt-1`} value={previewIndex} onChange={(value) => setPreviewIndex(Number(value))} options={draft.targets.map((item, index) => ({ value: index, label: `第 ${item.requestIndex + 1} 张 · ${tasks.find((task) => task.id === item.taskId)?.prompt.slice(0, 24)}` }))} /></div>}
              <div className="mt-5"><button type="button" disabled={annotationDisabled || !previewImage} onClick={() => { void openBoard() }} className={`${BUTTON_CLASS} inline-flex items-center gap-1.5 bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20`}><EditIcon className="h-4 w-4" />{draft.annotation ? '修改画板标注' : '画板标注'}</button><p className="mt-2 text-xs leading-5 text-gray-500">{batch ? '批量不支持画板标注，请只选择一张图片。' : draft.mode === 'rerun' ? '切换到“修改这张图”后可使用画板。' : '圈选、文字和位置评论会随本次修改提交；模型不保证只修改标注区域。'}</p></div>
              <p className="mt-auto pt-6 text-xs text-gray-400">生成结果保留为新版本，原图继续保留。</p>
            </section>
            <section aria-label="生成设置" className="min-w-0 p-5 sm:p-6">
              <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.04]">{(['edit', 'rerun'] as const).map((mode) => <button key={mode} aria-pressed={draft.mode === mode} disabled={submitting} onClick={() => { if (mode !== draft.mode) update({ mode, promptMode: mode === 'rerun' ? 'append' : 'replace', annotation: undefined }) }} className={`flex-1 rounded-lg px-2 py-2 text-xs transition ${draft.mode === mode ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400' : 'text-gray-500'}`}>{mode === 'edit' ? batch ? '修改选中图片' : '修改这张图' : batch ? '重新生成一批' : '重新生成一张'}</button>)}</div>
              <p className="mb-4 mt-2 text-xs leading-5 text-gray-500">{draft.mode === 'edit' ? batch ? '以选中的每张图片为参考，按同一要求分别修改。' : '以当前图片为参考，按下方要求或画板标注修改。' : '沿用原提示词、原参考图和遮罩重新生成，可补充要求。'}</p>
              <div className="mb-2 flex justify-between text-xs"><label htmlFor="regeneration-prompt">{draft.mode === 'rerun' ? '补充要求（选填）' : batch ? '统一修改要求' : '修改要求'}</label><button onClick={() => setShowOriginal(!showOriginal)} className="text-gray-400">{showOriginal ? '收起' : '查看'}原提示词</button></div>
              {showOriginal && <p className="mb-2 whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-white/[0.04]">{source ? getTaskPromptText(source.prompt, source.inputImageIds.length) : '来源任务已不存在'}</p>}
              <textarea id="regeneration-prompt" aria-describedby="regeneration-prompt-help" disabled={submitting} value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} rows={3} placeholder={draft.mode === 'rerun' ? '可补充新的要求；不填则按原要求重新生成' : '描述希望修改的内容，例如：把顶部主色改成蓝色…'} className={`${FIELD_CLASS} resize-y leading-6`} />
              <p id="regeneration-prompt-help" className="mt-2 text-xs leading-5 text-gray-500" aria-live="polite">{draft.mode === 'rerun'
                ? '补充内容会自动接在原提示词后；不填则按原要求重新生成。'
                : batch ? '本次要求会应用到每张选中的图片。' : '只需填写本次要求，也可直接用画板标注。'}</p>
              {draft.annotation && <p className="mt-2 text-xs text-blue-500">已保存标注 · {draft.annotation.comments.length} 条位置评论</p>}
              <div className="mb-2 mt-5 flex justify-between text-xs"><span>生成参数</span><span className="text-gray-400">{batch && !draft.params ? '各自保留，可统一设置' : '已带入原参数，可修改'}</span></div>
              <div className="mb-2 text-xs text-gray-500">配置<Select ariaLabel="重生成配置" disabled={submitting} className={`${FIELD_CLASS} mt-1`} value={draft.profile ? `${draft.profile.scope}:${draft.profile.id}` : ''} onChange={(value) => {
                const entry = profiles.find((entry) => `${entry.scope}:${entry.profile.id}` === value)
                update({ profile: entry ? { id: entry.profile.id, scope: entry.scope, model: resolveApiProfileModel(entry.profile).model } : undefined })
              }} options={[
                { value: '', label: batch ? '沿用各自来源配置' : sourceProfile ? `${getApiProviderLabel(settings, sourceProfile.provider)} · ${sourceProfile.name}（来源配置）` : '原配置不可用，请主动选择' },
                ...profiles.map((entry) => ({ value: `${entry.scope}:${entry.profile.id}`, label: `${entry.scope === 'agent' ? 'Agent 来源 · ' : ''}${getApiProviderLabel(settings, entry.profile.provider)} · ${entry.profile.name}` })),
              ]} /></div>
              <div className="mb-3 text-xs text-gray-500">模型<Select ariaLabel="重生成模型" disabled={submitting || !profile || locked} value={profile?.model ?? ''} className={`${FIELD_CLASS} mt-1`} onChange={(value) => {
                if (!profile || locked) return
                update({ profile: { id: profile.id, scope: draft.profile?.scope ?? (source ? getTaskApiConfigScope(source) : 'gallery'), model: String(value) } })
              }} options={profile ? [...new Set([profile.model, ...splitModelList(selectedProfile?.profile.model ?? profiles.find((entry) => entry.profile.id === sourceProfile?.id && entry.scope === (source ? getTaskApiConfigScope(source) : 'gallery'))?.profile.model ?? sourceProfile?.model ?? '')])].filter(Boolean).map((model) => ({ value: model, label: model })) : [{ value: '', label: '请先选择配置' }]} />{profile?.apiMode === 'responses' && <span className="mt-1 block text-[11px]">图片工具：{profile.imageGenerationModel || '接口默认'}</span>}</div>
              {batch && <label className="mb-3 flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={Boolean(draft.params)} disabled={submitting || locked} onChange={(event) => update({ params: event.target.checked ? { ...params, n: draft.count } : undefined })} />统一设置以下参数（未勾选则各自保留）</label>}
              <label className="min-w-0 text-xs text-gray-500">每张源图生成<input aria-label="每张源图生成数量" aria-describedby="regeneration-count-help" aria-invalid={Boolean(countError)} disabled={submitting || locked} type="text" inputMode="numeric" pattern="[0-9]*" value={countInput} className={`${FIELD_CLASS} mt-1`} onChange={(event) => updateCount(event.target.value)} onBlur={() => { if (!countInput) updateCount('1') }} /></label>
              <p id="regeneration-count-help" role={countError ? 'alert' : undefined} className={`mb-3 mt-1 text-xs ${countError ? 'text-red-500' : 'text-gray-400'}`}>{countError || `每张最多 ${countLimit} 张，一次合计最多 10 张。`}</p>
              <fieldset disabled={paramsDisabled} className="grid min-w-0 grid-cols-2 gap-2 disabled:opacity-60">
                <label className="min-w-0 text-xs text-gray-500">{ratioOnly ? '目标比例' : profile?.provider === 'grok' ? '比例 / 分辨率' : '尺寸'}<button type="button" onClick={() => setShowSizePicker(true)} className={`${FIELD_CLASS} mt-1 text-left`}>{profile?.provider === 'grok' ? `${params.aspect_ratio ?? '1:1'} · ${params.resolution ?? '1k'}` : ratioOnly ? getRequestedImageAspectRatio(params) : params.size}</button></label>
                <div className="min-w-0 text-xs text-gray-500">输出格式<Select ariaLabel="重生成输出格式" disabled={paramsDisabled} value={params.output_format} className={`${FIELD_CLASS} mt-1`} onChange={(value: TaskParams['output_format']) => { if (capabilities?.formats.includes(value)) updateParams({ output_format: value }) }} options={(['png', 'jpeg', 'webp'] as const).map((format) => ({ value: format, label: format.toUpperCase(), disabled: !capabilities?.formats.includes(format) && !(format === 'png' && !capabilities?.formats.length), disabledReason: capabilities?.formatReasons[format] ?? capabilities?.outputReason }))} /></div>
                <div className="min-w-0 text-xs text-gray-500">质量<Select ariaLabel="重生成质量" disabled={paramsDisabled} value={params.quality} className={`${FIELD_CLASS} mt-1`} onChange={(quality: TaskParams['quality']) => { if (capabilities?.qualities.includes(quality)) updateParams({ quality }) }} options={(['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((quality) => ({ value: quality, label: quality, disabled: !capabilities?.qualities.includes(quality), disabledReason: capabilities?.qualityReason }))} /></div>
                <details className="col-span-2 text-xs text-gray-500"><summary className="cursor-pointer py-2">更多参数</summary><div className="grid grid-cols-2 gap-2">
                  <label>压缩率<input aria-label="重生成压缩率" type="number" min={0} max={100} disabled={!capabilities?.compression || params.output_format === 'png'} value={params.output_compression ?? ''} placeholder="接口默认" onChange={(event) => { if (capabilities?.compression && params.output_format !== 'png') updateParams({ output_compression: event.target.value === '' ? null : Number(event.target.value) }) }} className={`${FIELD_CLASS} mt-1`} /></label>
                  <div>构图复杂度<Select ariaLabel="重生成构图复杂度" disabled={paramsDisabled || !capabilities?.complexity} value={params.complexity ?? ''} onChange={(value: TaskParams['complexity'] | '') => { if (capabilities?.complexity) updateParams({ complexity: value || undefined }) }} className={`${FIELD_CLASS} mt-1`} options={['', 'low', 'medium', 'high'].map((value) => ({ value, label: value || '接口默认' }))} /></div>
                  <div>内容审核<Select ariaLabel="重生成内容审核" disabled={paramsDisabled || !capabilities?.moderation} value={params.moderation} onChange={(value: TaskParams['moderation']) => { if (capabilities?.moderation) updateParams({ moderation: value }) }} className={`${FIELD_CLASS} mt-1`} options={['auto', 'low'].map((value) => ({ value, label: value }))} /></div>
                  <label className="col-span-2"><input type="checkbox" checked={params.transparent_output} disabled={params.output_format === 'jpeg' || !(capabilities?.transparency || profile?.transparentBackgroundMethod === 'local')} onChange={(event) => updateParams({ transparent_output: event.target.checked })} className="mr-2" />{profile?.transparentBackgroundMethod === 'local' ? '本地去背景' : '透明背景'}</label>
                  <p className="col-span-2 leading-5">{capabilities?.outputReason}；PNG 不支持压缩率参数。</p>
                </div></details>
              </fieldset>
              {ratioOnly && <p className="mt-2 text-[11px] leading-5 text-gray-500">当前本站路径无法保证 1K / 2K / 4K，入口在比例弹窗内保留置灰；这不代表 GPT 模型本身不支持。</p>}
              {locked && <p className="mt-2 text-xs text-gray-500">部署预置参数已锁定。</p>}
              {profile && outputIssues.length > 0 && <div className="mt-3 text-xs text-amber-600" role="alert"><p>{outputIssues[0]}</p><button disabled={submitting || locked} className="mt-1 text-blue-500" onClick={() => updateParams({ quality: 'auto', output_format: 'png', output_compression: null, transparent_output: false, moderation: 'auto', complexity: undefined })}>恢复可用参数</button></div>}
            </section>
          </div>
          {error && <p role="alert" className="px-6 pb-4 text-sm text-red-500">{error}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 dark:border-white/[0.08] sm:px-6">
          <p aria-live="polite" className="text-xs text-gray-500">{submitting && batchProgress ? `已开始 ${batchProgress.started} / ${batchProgress.total}，已完成 ${batchProgress.finished}` : countError ? '请先设置有效的生成数量' : `${draft.targets.length} 张源图 × ${draft.count} 张结果，共生成 ${draft.targets.length * draft.count} 张`}</p>
          <div className="ml-auto flex gap-2">{submitting && batchProgress ? <button onClick={() => stopBatchPrompts()} className={`${BUTTON_CLASS} bg-red-50 text-red-500 dark:bg-red-500/10`}>停止剩余提交</button> : <button disabled={submitting} onClick={close} className={`${BUTTON_CLASS} bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300`}>取消</button>}<button disabled={submitting || Boolean(countError) || !draft.targets.length || !profile || outputIssues.length > 0 && Boolean(draft.params)} onClick={() => { void submit() }} className={`${BUTTON_CLASS} bg-blue-500 px-4 text-white hover:bg-blue-600`}>{submitting ? '生成中…' : batch && !countError ? `生成 ${draft.targets.length * draft.count} 张新图` : '生成新版本'}</button></div>
        </footer>
      </div>
    </div>
    {showSizePicker && profile && <div className="fixed inset-0 z-[75]"><SizePickerModal currentSize={params.size} imageAspectRatio={params.imageAspectRatio} ratioOnly={ratioOnly} sizeMode={capabilities?.sizeMode} codexCli={profile.codexCli} grokModel={profile.provider === 'grok' ? profile.model : ''} grokResolution={params.resolution} grokAspectRatio={params.aspect_ratio} onGrokSelect={(patch) => { updateParams(patch); setShowSizePicker(false) }} onSelect={(size, imageAspectRatio) => { updateParams({ size, imageAspectRatio }); setShowSizePicker(false) }} onClose={() => setShowSizePicker(false)} /></div>}
  </>
}
