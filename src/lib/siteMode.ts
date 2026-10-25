import { isTauri } from './platform'
import { readRuntimeEnv } from './runtimeEnv'

// 本分支默认作为站点工作台使用；显式关闭可恢复上游网页入口，客户端不受影响。
export const IS_SITE_MODE = !isTauri && readRuntimeEnv(import.meta.env.VITE_SITE_MODE, 'VITE_SITE_MODE') !== 'false'
