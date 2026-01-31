# 模板系统设计

> 自定义 Review 模板，支持灵活定制审查风格和关注点。

## 设计目标

1. **灵活定制** - 用户可以根据项目特点自定义审查规则
2. **模板继承** - 基于系统模板扩展
3. **变量支持** - 支持动态变量注入上下文信息
4. **分类标签** - 结构化的问题分类和严重级别

## 模板结构

```typescript
interface ReviewTemplate {
  id: string
  name: string
  description?: string
  
  // 核心内容
  systemPrompt: string          // AI System Prompt
  categories: ReviewCategory[]  // 问题分类
  severities: ReviewSeverity[]  // 严重级别
  
  // 元数据
  isSystem: boolean  // 系统内置模板
  isDefault: boolean // 默认模板
  userId?: string    // 创建者（系统模板为 null）
}

type ReviewCategory = 
  | 'BUG'         // 代码缺陷
  | 'SECURITY'    // 安全问题
  | 'PERFORMANCE' // 性能问题
  | 'STYLE'       // 代码风格
  | 'DOCS'        // 文档问题
  | 'TEST'        // 测试问题
  | 'LOGIC'       // 逻辑问题
  | 'REFACTOR'    // 重构建议

type ReviewSeverity = 
  | 'CRITICAL'    // 严重：必须修复
  | 'HIGH'        // 高：建议修复
  | 'MEDIUM'      // 中：可考虑
  | 'LOW'         // 低：可忽略
```

## 系统内置模板

### 默认模板

```yaml
id: system-default
name: 默认模板
description: 通用代码审查模板，适用于大多数项目
isSystem: true
isDefault: true
categories:
  - BUG
  - SECURITY
  - PERFORMANCE
  - STYLE
severities:
  - CRITICAL
  - HIGH
  - MEDIUM
  - LOW
systemPrompt: |
  你是一位资深的代码审查专家。请对提交的代码变更进行专业审查。

  ## 审查重点

  1. **代码缺陷 (BUG)**: 逻辑错误、边界条件、空指针、资源泄露
  2. **安全问题 (SECURITY)**: 注入攻击、敏感信息暴露、权限问题
  3. **性能问题 (PERFORMANCE)**: 低效算法、内存泄露、不必要的计算
  4. **代码风格 (STYLE)**: 命名规范、代码结构、可读性

  ## 评论格式

  使用结构化标签格式：`**[分类:严重级别]**`

  示例：
  - `**[BUG:CRITICAL]**` - 严重缺陷
  - `**[SECURITY:HIGH]**` - 高危安全问题
  - `**[PERFORMANCE:MEDIUM]**` - 中等性能问题
  - `**[STYLE:LOW]**` - 轻微风格问题

  ## 审查原则

  - 只评论有明确问题的代码，避免不必要的评论
  - 提供具体的修复建议，而非仅指出问题
  - 对于复杂问题，解释原因和潜在影响
  - 保持专业和建设性的语气

  ## 审查决策

  根据问题的严重程度决定：
  - **APPROVE**: 无问题或仅有低级别建议
  - **REQUEST_CHANGES**: 存在 CRITICAL 或多个 HIGH 级别问题
  - **COMMENT**: 存在需要关注但不阻塞合并的问题
```

### 严格模式模板

```yaml
id: system-strict
name: 严格模式
description: 更严格的代码规范检查，适用于核心模块
isSystem: true
isDefault: false
categories:
  - BUG
  - SECURITY
  - PERFORMANCE
  - STYLE
  - LOGIC
  - TEST
severities:
  - CRITICAL
  - HIGH
  - MEDIUM
systemPrompt: |
  你是一位严格的代码审查专家，负责审查核心模块的代码变更。
  
  ## 审查标准（严格模式）

  ### 必须满足
  - 所有公开 API 必须有完整的类型定义
  - 关键逻辑必须有对应的测试用例
  - 不允许使用 any 类型
  - 不允许忽略错误处理
  - 不允许硬编码敏感信息

  ### 强烈建议
  - 函数不超过 50 行
  - 圈复杂度不超过 10
  - 有意义的变量和函数命名
  - 适当的代码注释

  ## 评论格式

  使用 `**[分类:严重级别]**` 格式标记问题。

  ## 审查决策

  - **APPROVE**: 完全符合标准
  - **REQUEST_CHANGES**: 存在任何 CRITICAL/HIGH 问题
  - **COMMENT**: 存在 MEDIUM 问题（不阻塞但需跟进）
```

### 快速检查模板

```yaml
id: system-quick
name: 快速检查
description: 快速检查明显问题，适用于小改动
isSystem: true
isDefault: false
categories:
  - BUG
  - SECURITY
severities:
  - CRITICAL
  - HIGH
systemPrompt: |
  你是代码审查助手，请快速检查代码中的明显问题。

  ## 关注重点

  仅关注以下严重问题：
  - 明显的代码缺陷
  - 安全漏洞
  - 可能导致生产事故的问题

  ## 原则

  - 只标记确定的问题，不做推测
  - 不评论代码风格
  - 快速、精准、简洁

  如果没有发现严重问题，直接 APPROVE。
```

## 模板变量

模板支持动态变量，在执行时会被替换为实际值：

### 可用变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{repo.name}}` | 仓库全名 | `owner/repo-name` |
| `{{repo.provider}}` | 平台类型 | `gitea` |
| `{{pr.number}}` | PR 编号 | `42` |
| `{{pr.title}}` | PR 标题 | `feat: Add feature` |
| `{{pr.author}}` | PR 作者 | `developer` |
| `{{pr.branch.source}}` | 源分支 | `feature/xxx` |
| `{{pr.branch.target}}` | 目标分支 | `main` |
| `{{files.count}}` | 变更文件数 | `5` |
| `{{files.list}}` | 文件列表 | `src/a.ts, src/b.ts` |
| `{{config.language}}` | 审查语言 | `zh-CN` |
| `{{config.style}}` | 审查风格 | `detailed` |
| `{{date}}` | 当前日期 | `2024-01-15` |

### 使用示例

```yaml
systemPrompt: |
  你正在审查仓库 {{repo.name}} 的 PR #{{pr.number}}。
  
  PR 信息：
  - 标题：{{pr.title}}
  - 作者：{{pr.author}}
  - 分支：{{pr.branch.source}} → {{pr.branch.target}}
  - 变更文件数：{{files.count}}
  
  请使用 {{config.language}} 语言进行审查。
  审查风格：{{config.style}}
```

### 变量渲染

```typescript
// packages/core/src/templates/renderer.ts

interface TemplateContext {
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

export function renderTemplate(
  template: string, 
  context: TemplateContext
): string {
  return template.replace(
    /\{\{([^}]+)\}\}/g,
    (match, path) => {
      const value = getNestedValue(context, path.trim())
      return value !== undefined ? String(value) : match
    }
  )
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}
```

## 模板编辑器 UI

### 功能设计

```
┌─────────────────────────────────────────────────────────────┐
│  模板编辑器                                          [保存]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  名称: [前端项目模板                    ]                   │
│                                                             │
│  描述: [针对 React/Vue 项目的专业审查模板]                  │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  问题分类:                                                  │
│  [✓] BUG  [✓] SECURITY  [✓] PERFORMANCE  [✓] STYLE         │
│  [ ] DOCS  [ ] TEST  [ ] LOGIC  [✓] ACCESSIBILITY          │
│                                                             │
│  严重级别:                                                  │
│  [✓] CRITICAL  [✓] HIGH  [✓] MEDIUM  [✓] LOW               │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  System Prompt:                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 你是一位资深的前端代码审查专家...                   │   │
│  │                                                     │   │
│  │ ## 审查重点                                         │   │
│  │                                                     │   │
│  │ 1. **React/Vue 最佳实践**                           │   │
│  │ 2. **性能优化**                                     │   │
│  │ 3. **无障碍访问 (A11y)**                            │   │
│  │                                                     │   │
│  │ 可用变量：{{repo.name}}, {{pr.title}}...            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [插入变量 ▼]  [预览 Prompt]  [从模板复制]                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 组件实现

```tsx
// packages/web/src/components/template-editor.tsx

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const CATEGORIES = [
  { id: 'BUG', label: '代码缺陷', color: 'red' },
  { id: 'SECURITY', label: '安全问题', color: 'orange' },
  { id: 'PERFORMANCE', label: '性能问题', color: 'yellow' },
  { id: 'STYLE', label: '代码风格', color: 'blue' },
  { id: 'DOCS', label: '文档问题', color: 'gray' },
  { id: 'TEST', label: '测试问题', color: 'purple' },
  { id: 'LOGIC', label: '逻辑问题', color: 'pink' },
  { id: 'REFACTOR', label: '重构建议', color: 'green' },
]

const SEVERITIES = [
  { id: 'CRITICAL', label: '严重', color: 'red' },
  { id: 'HIGH', label: '高', color: 'orange' },
  { id: 'MEDIUM', label: '中', color: 'yellow' },
  { id: 'LOW', label: '低', color: 'gray' },
]

const VARIABLES = [
  { key: '{{repo.name}}', label: '仓库名称' },
  { key: '{{pr.number}}', label: 'PR 编号' },
  { key: '{{pr.title}}', label: 'PR 标题' },
  { key: '{{pr.author}}', label: 'PR 作者' },
  { key: '{{files.count}}', label: '文件数量' },
  { key: '{{config.language}}', label: '审查语言' },
]

export function TemplateEditor({ 
  template, 
  onChange 
}: { 
  template: ReviewTemplate
  onChange: (template: ReviewTemplate) => void 
}) {
  const [showPreview, setShowPreview] = useState(false)

  const insertVariable = (variable: string) => {
    // 在光标位置插入变量
    const textarea = document.querySelector('textarea')
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newPrompt = 
        template.systemPrompt.slice(0, start) + 
        variable + 
        template.systemPrompt.slice(end)
      onChange({ ...template, systemPrompt: newPrompt })
    }
  }

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <div className="grid gap-4">
        <Input 
          label="名称" 
          value={template.name}
          onChange={(e) => onChange({ ...template, name: e.target.value })}
        />
        <Textarea 
          label="描述" 
          value={template.description}
          onChange={(e) => onChange({ ...template, description: e.target.value })}
          rows={2}
        />
      </div>

      {/* 分类选择 */}
      <div>
        <Label>问题分类</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {CATEGORIES.map((cat) => (
            <Badge
              key={cat.id}
              variant={template.categories.includes(cat.id) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleCategory(cat.id)}
            >
              {cat.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* 严重级别 */}
      <div>
        <Label>严重级别</Label>
        <div className="flex gap-2 mt-2">
          {SEVERITIES.map((sev) => (
            <Badge
              key={sev.id}
              variant={template.severities.includes(sev.id) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleSeverity(sev.id)}
            >
              {sev.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <Label>System Prompt</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                插入变量
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {VARIABLES.map((v) => (
                <DropdownMenuItem 
                  key={v.key}
                  onClick={() => insertVariable(v.key)}
                >
                  <code className="mr-2">{v.key}</code>
                  <span className="text-muted-foreground">{v.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Textarea
          value={template.systemPrompt}
          onChange={(e) => onChange({ ...template, systemPrompt: e.target.value })}
          rows={15}
          className="font-mono text-sm"
          placeholder="输入 AI 的 System Prompt..."
        />
      </div>
    </div>
  )
}
```

## 模板导入导出

### 导出格式

```yaml
# template-export.yaml
version: 1
template:
  name: 我的模板
  description: 自定义审查模板
  categories:
    - BUG
    - SECURITY
  severities:
    - CRITICAL
    - HIGH
    - MEDIUM
  systemPrompt: |
    你是一位专业的代码审查专家...
```

### 导入导出 API

```typescript
// POST /api/v1/templates/export/:id
// 响应: YAML 文件下载

// POST /api/v1/templates/import
// 请求: multipart/form-data 上传 YAML 文件
// 响应: 创建的模板对象
```

## 模板与仓库绑定

每个仓库可以指定使用的模板：

1. **默认行为**: 使用系统默认模板
2. **仓库级配置**: 在仓库设置中选择模板
3. **临时覆盖**: 通过评论命令指定模板

```
# 评论命令示例
/oc --template=strict
/opencode review --template=quick
```

## 模板继承（未来功能）

```yaml
# 基于系统模板扩展
extends: system-default
name: 扩展模板
overrides:
  categories:
    add:
      - ACCESSIBILITY
  systemPrompt:
    append: |
      
      ## 额外检查
      - 无障碍访问合规性
```
