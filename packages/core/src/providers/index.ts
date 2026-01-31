/**
 * Provider 模块导出
 */

import { GiteaProvider } from './gitea'
import type { GitProvider, ProviderConfig, ProviderType } from './types'

export * from './types'
export { BaseProvider } from './base'
export { GiteaProvider } from './gitea'

/**
 * 创建 Provider 实例
 */
export function createProvider(config: ProviderConfig): GitProvider {
  switch (config.type) {
    case 'gitea':
      return new GiteaProvider(config.baseUrl, config.token)
    case 'github':
      throw new Error('GitHub provider not implemented yet')
    case 'gitlab':
      throw new Error('GitLab provider not implemented yet')
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`)
  }
}

/**
 * 从环境变量自动检测并创建 Provider
 */
export function createProviderFromEnv(env: Record<string, string | undefined> = process.env): GitProvider | null {
  // 尝试 Gitea 环境变量
  if (env.GITEA_SERVER_URL && env.GITEA_TOKEN) {
    return new GiteaProvider(env.GITEA_SERVER_URL, env.GITEA_TOKEN)
  }

  // 尝试 GitHub 格式的环境变量（Gitea Actions 兼容）
  if (env.GITHUB_SERVER_URL && env.GITHUB_TOKEN && !env.GITEA_SERVER_URL) {
    // 检查是否真的是 GitHub
    if (env.GITHUB_SERVER_URL.includes('github.com')) {
      // TODO: 未来支持 GitHub
      return null
    }
    // 可能是 Gitea 使用 GitHub 风格的变量名
    return new GiteaProvider(env.GITHUB_SERVER_URL, env.GITHUB_TOKEN)
  }

  return null
}

/**
 * 获取支持的 Provider 类型列表
 */
export function getSupportedProviders(): ProviderType[] {
  return ['gitea']  // 后续添加 'github', 'gitlab'
}
