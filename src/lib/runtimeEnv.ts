/** 读取具名部署配置，优先使用本次页面加载的值；未覆盖时兼容原有构建值，显式空串保留为空。 */
export function readRuntimeEnv(value: string | undefined, name?: string): string {
  const config = typeof window === 'undefined' ? undefined : window.__GPT_IMAGE_RUNTIME_CONFIG__
  const runtimeValue = name && config && Object.prototype.hasOwnProperty.call(config, name) ? config[name] : undefined
  return (typeof runtimeValue === 'string' ? runtimeValue : value ?? '').trim()
}

/** Docker 页面启动前检查配置是否已成功加载；缺失或字段格式损坏时抛错，阻止误用构建默认接口。 */
export function assertRuntimeConfigLoaded(): void {
  const config = typeof window === 'undefined' ? undefined : window.__GPT_IMAGE_RUNTIME_CONFIG__
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.VITE_DOCKER_DEPLOYMENT !== 'true' || Object.values(config).some((value) => typeof value !== 'string')) {
    throw new Error('站点配置加载失败，请刷新重试或联系管理员。')
  }
}
