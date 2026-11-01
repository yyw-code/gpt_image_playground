import { useId, useState } from 'react'
import { splitModelList } from '../../lib/apiProfiles'
import { ChevronDownIcon } from '../icons'

interface ModelPickerProps {
  label: string
  value: string
  models: string[]
  placeholder: string
  disabled: boolean
  multiple?: boolean
  allowDefault?: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
}

/** 保留模型手动编辑，并展开可搜索的候选列表；多选保留旧值，空工具模型表示使用接口默认值。 */
export default function ModelPicker({ label, value, models, placeholder, disabled, multiple = false, allowDefault = false, onChange, onCommit }: ModelPickerProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const selected = multiple ? splitModelList(value) : value ? [value] : []
  const options = [...new Set([...models, ...selected])]
    .filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()))
    .map((model) => ({ value: model, label: model }))
  if (allowDefault && (!query || '使用接口默认值'.includes(query.trim()))) options.unshift({ value: '', label: '使用接口默认值' })

  /** 只在用户明确选择时提交；多模型使用原有逗号格式，不改动配置结构。 */
  const selectModel = (model: string) => {
    const next = multiple
      ? (selected.includes(model) ? selected.filter((item) => item !== model) : [...selected, model]).join(', ')
      : model
    onChange(next)
    onCommit(next)
    if (!multiple) setOpen(false)
  }

  return (
    <div className="block">
      <label htmlFor={id} className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">{label}</label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          className="w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <button
          type="button"
          aria-label={`选择${label}`}
          aria-expanded={open && !disabled}
          aria-controls={`${id}-options`}
          disabled={disabled}
          onClick={() => { setOpen(!open); setQuery(''); setIndex(0) }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40 dark:hover:text-gray-200"
        >
          <ChevronDownIcon className="h-4 w-4" />
        </button>
      </div>
      {open && !disabled && (
        <div className="mt-1 rounded-xl border border-gray-200/60 bg-white p-2 dark:border-white/[0.08] dark:bg-gray-800">
          <input
            type="search"
            aria-label={`搜索${label}`}
            placeholder="搜索模型 ID"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setIndex(0) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
              if (!options.length || event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                selectModel((options[index] ?? options[0]).value)
              }
            }}
            className="mb-1 w-full rounded-lg bg-black/[0.04] px-2 py-1.5 text-xs outline-none dark:bg-white/[0.06]"
          />
          <div className="mb-1 px-2 text-[11px] text-gray-400">{multiple ? '可多选；也可直接输入，多个模型以逗号分隔。' : '选择候选或直接输入模型 ID。'}</div>
          <div id={`${id}-options`} role="listbox" aria-label={`${label}候选`} aria-multiselectable={multiple || undefined} className="max-h-40 overflow-y-auto">
            {options.map((option, optionIndex) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === '' ? value === '' : selected.includes(option.value)}
                onClick={() => selectModel(option.value)}
                onMouseEnter={() => setIndex(optionIndex)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs break-all ${optionIndex === index ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}
              >
                <span className="w-3 shrink-0">{(option.value === '' ? value === '' : selected.includes(option.value)) ? '✓' : ''}</span>
                <span>{option.label}</span>
                {option.value && !models.includes(option.value) && <span className="shrink-0 text-gray-400">已保存</span>}
              </button>
            ))}
            {options.length === 0 && <div className="px-2 py-2 text-xs text-gray-400">{models.length ? '没有匹配模型，可手动输入。' : '尚无候选，请先获取模型或手动输入。'}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
