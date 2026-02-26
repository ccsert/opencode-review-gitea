/**
 * Provider 模块导出
 */

import { GiteaProvider } from './gitea'
import { GitLabProvider } from './gitlab'
import { GitHubProvider } from './github'
import type { GitProvider, ProviderConfig, ProviderType } from './types'

export * from './types'
export { BaseProvider } from './base'
export { GiteaProvider } from './gitea'
export { GitLabProvider } from './gitlab'
export { GitHubProvider } from './github'

/**
 * 创建 Provider 实例
 */
export function createProvider(config: ProviderConfig): GitProvider {
  switch (config.type) {
    case 'gitea':
      return new GiteaProvider(config.baseUrl, config.token)
    case 'github':
      return new GitHubProvider(config.baseUrl, config.token)
    case 'gitlab':
      return new GitLabProvider(config.baseUrl, config.token)
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

  // 尝试 GitLab 环境变量
  if (env.GITLAB_SERVER_URL && env.GITLAB_TOKEN) {
    return new GitLabProvider(env.GITLAB_SERVER_URL, env.GITLAB_TOKEN)
  }

  // 尝试 GitHub 格式的环境变量（Gitea Actions 兼容）
  if (env.GITHUB_SERVER_URL && env.GITHUB_TOKEN && !env.GITEA_SERVER_URL) {
    // 检查是否真的是 GitHub
    if (env.GITHUB_SERVER_URL.includes('github.com')) {
      return new GitHubProvider('https://api.github.com', env.GITHUB_TOKEN)
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
  return ['gitea', 'github', 'gitlab']
}
