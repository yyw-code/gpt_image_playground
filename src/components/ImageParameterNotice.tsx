import type { TaskParams, TaskRecord } from '../types'
import { getImageParameterCheck } from '../lib/paramDisplay'

/** 仅补充参数来源和缺失回显说明；差异在各参数旁标黄，不重复展示警告块或改变任务状态。 */
export default function ImageParameterNotice({ task, actualParams }: { task: TaskRecord; actualParams: Partial<TaskParams> }) {
  const check = getImageParameterCheck(task, actualParams)
  if (task.params.imageAspectRatio !== undefined) return <p className="mb-4 text-xs text-gray-500">实际分辨率由模型决定；目标比例按原图核对，偏差超过 1% 时在比例旁标黄提示，无法核对时显示未验证。</p>
  if (task.imageParameterMode === 'composition' || task.imageParameterMode === 'default') return <p className="mb-4 text-xs text-gray-500">{task.imageParameterMode === 'composition' ? '此任务使用构图兼容模式，尺寸仅作构图参考，未发送精确像素；实际尺寸、质量和格式由接口决定。黄色值表示与参考尺寸不同。' : '此任务使用接口默认参数，未发送原生尺寸、质量和格式。'}</p>
  if (!check.unverified.length && task.imageParameterMode) return null
  return (
    <div role="status" aria-label="当前图片参数核对" className="mb-4 space-y-1 text-xs text-gray-500">
      {check.unverified.length > 0 && <p>未验证：{check.unverified.map((item) => item.label).join('、')}（接口未提供可核对值）。</p>}
      {!task.imageParameterMode && <p>此记录未保存参数模式，仅比较当时设置，不代表这些字段实际发送给了接口。</p>}
    </div>
  )
}
