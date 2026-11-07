import type { TaskParams, TaskRecord } from '../types'
import { getImageParameterCheck } from '../lib/paramDisplay'

/** 展示当前成功图片与任务设置的差异；不改变成功状态、不触发重试，未知回显明确保留为未验证。 */
export default function ImageParameterNotice({ task, actualParams }: { task: TaskRecord; actualParams: Partial<TaskParams> }) {
  const check = getImageParameterCheck(task, actualParams)
  if (task.imageParameterMode === 'composition' || task.imageParameterMode === 'default') return <p className="mb-4 text-xs text-gray-500">{task.imageParameterMode === 'composition' ? '此任务使用构图兼容模式，比例仅作提示词引导；像素、质量和格式由接口决定。' : '此任务使用接口默认参数，未发送原生尺寸、质量和格式。'}</p>
  if (!check.checked && !check.unverified.length) return null
  return (
    <div role="status" aria-label="当前图片参数核对" className={`mb-4 rounded-lg px-3 py-2 text-xs ${check.mismatches.length ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-gray-50 text-gray-600 dark:bg-white/[0.03] dark:text-gray-400'}`}>
      <p className="font-medium">{check.mismatches.length ? '已生成，参数与设置不符' : check.unverified.length ? '已生成，部分参数未验证' : '已生成，已返回参数与设置一致'}</p>
      {check.mismatches.length > 0 && <ul className="mt-1 space-y-1">
        {check.mismatches.map((item) => <li key={item.key}>{item.label}：设置 {item.requestedValue}，返回 {item.displayValue}</li>)}
      </ul>}
      {check.unverified.length > 0 && <p className="mt-1">未验证：{check.unverified.map((item) => item.label).join('、')}（接口未提供可核对值）。</p>}
      {!task.imageParameterMode && <p className="mt-1">此记录未保存统一的参数模式，以上仅比较当时设置，不代表这些字段实际发送给了接口。</p>}
      <p className="mt-1">{task.apiProvider === 'grok' ? '比例按实际宽高核对，分辨率档位与质量仅核对接口回显。' : '质量与复杂度仅核对接口回显，不代表视觉效果。'}图片可正常下载，不会自动重试。</p>
    </div>
  )
}
