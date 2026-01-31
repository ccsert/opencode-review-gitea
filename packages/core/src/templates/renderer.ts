/**
 * 模板渲染器
 */

export interface TemplateContext {
  repo: {
    name: string
    provider: string
  }
  pr: {
    number: number
    title: string
    author: string
    branch: {
      source: string
      target: string
    }
  }
  files: {
    count: number
    list: string[]
  }
  config: {
    language: string
    style: string
  }
  date: string
}

/**
 * 渲染模板，替换变量
 * 
 * @example
 * renderTemplate('Hello {{repo.name}}', { repo: { name: 'test' } })
 * // => 'Hello test'
 */
export function renderTemplate(
  template: string, 
  context: TemplateContext
): string {
  return template.replace(
    /\{\{([^}]+)\}\}/g,
    (match, path) => {
      const value = getNestedValue(context, path.trim())
      if (value === undefined || value === null) {
        return match  // 保留原始占位符
      }
      if (Array.isArray(value)) {
        return value.join(', ')
      }
      return String(value)
    }
  )
}

/**
 * 获取嵌套对象的值
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

/**
 * 验证模板语法
 */
export function validateTemplate(template: string): {
  valid: boolean
  variables: string[]
  errors: string[]
} {
  const variables: string[] = []
  const errors: string[] = []
  
  const regex = /\{\{([^}]+)\}\}/g
  let match
  
  while ((match = regex.exec(template)) !== null) {
    const variable = match[1].trim()
    variables.push(variable)
    
    // 验证变量路径格式
    if (!/^[\w.]+$/.test(variable)) {
      errors.push(`Invalid variable format: {{${variable}}}`)
    }
  }

  return {
    valid: errors.length === 0,
    variables,
    errors,
  }
}

/**
 * 获取可用的模板变量列表
 */
export function getAvailableVariables(): Array<{
  key: string
  description: string
  example: string
}> {
  return [
    { key: '{{repo.name}}', description: '仓库名称', example: 'owner/repo-name' },
    { key: '{{repo.provider}}', description: '平台类型', example: 'gitea' },
    { key: '{{pr.number}}', description: 'PR 编号', example: '42' },
    { key: '{{pr.title}}', description: 'PR 标题', example: 'feat: Add feature' },
    { key: '{{pr.author}}', description: 'PR 作者', example: 'developer' },
    { key: '{{pr.branch.source}}', description: '源分支', example: 'feature/xxx' },
    { key: '{{pr.branch.target}}', description: '目标分支', example: 'main' },
    { key: '{{files.count}}', description: '变更文件数', example: '5' },
    { key: '{{files.list}}', description: '文件列表', example: 'src/a.ts, src/b.ts' },
    { key: '{{config.language}}', description: '审查语言', example: 'zh-CN' },
    { key: '{{config.style}}', description: '审查风格', example: 'detailed' },
    { key: '{{date}}', description: '当前日期', example: '2024-01-15' },
  ]
}
