# OpenCode Review Platform

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文文档](README_zh.md) | English

An **AI-powered code review platform** for Gitea/Forgejo, GitHub, and GitLab. Built on the [OpenCode](https://opencode.ai) plugin system, it offers two deployment modes:

1. **Gitea Actions Mode** - Works within your CI/CD pipeline
2. **Platform Mode (NEW!)** - Standalone web service with UI, multi-repo support, and webhook integration

## ✨ Features

### Core Features
- 🤖 **AI-Powered Code Review** - Uses Claude/GPT/DeepSeek models to analyze code changes
- 📝 **Line-Level Comments** - Provides precise feedback on specific code lines
- ✅ **Review Decisions** - Supports approve, request_changes, and comment states
- 🏷️ **Structured Tags** - Categorizes issues by type (BUG, SECURITY, PERFORMANCE) and severity

### Gitea Actions Mode
- 🔄 **Auto-Trigger** - Triggered by `/oc` or `/opencode` comments
- 📊 **Incremental Review** - Only reviews new changes since last review
- 🐳 **Docker Support** - Zero-config installation with pre-built image
- 🛡️ **Isolated Configuration** - Uses `.opencode-review/` directory

### Platform Mode (NEW!)
- 🌐 **Web UI** - Beautiful dashboard for managing repositories and reviews
- 🔐 **Authentication** - JWT + API Key authentication
- 📂 **Multi-Repository** - Manage multiple repos from one place
- 📋 **Custom Templates** - Create reusable review templates
- 📈 **Statistics** - Track review history and metrics
- 🔗 **Webhook Integration** - Direct webhook receiver without Gitea Actions Runner
- 💾 **Flexible Database** - SQLite (default) or PostgreSQL

---

## 📦 Installation

### Option 1: Gitea Actions Mode (Original)

For CI/CD pipeline integration:

```bash
# Interactive installation
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash

# Or direct Docker-based installation
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --docker
```

### Option 2: Platform Mode (NEW!)

For standalone web service:

```bash
# Clone the repository
git clone https://github.com/ccsert/opencode-review-gitea.git
cd opencode-review-gitea

# Using Docker Compose (SQLite)
cd docker
cp .env.example .env
# Edit .env with your settings
docker compose up -d

# Using Docker Compose (PostgreSQL)
docker compose -f docker-compose.postgres.yml up -d
```

---

## 🏗️ Architecture

```
opencode-review-gitea/
├── .opencode-review/          # Gitea Actions mode config
│   ├── agents/                # AI Agent definitions
│   ├── tools/                 # Custom tools
│   └── skills/                # Reusable skills
├── packages/                  # Platform mode (Monorepo)
│   ├── core/                  # Core library
│   │   ├── providers/         # Git provider abstraction
│   │   ├── events/            # Webhook event types
│   │   ├── review/            # Review engine
│   │   └── templates/         # Template system
│   ├── server/                # Hono + Bun API server
│   │   ├── routes/            # API endpoints
│   │   ├── middleware/        # Auth, error handling
│   │   └── db/                # Drizzle ORM schemas
│   └── web/                   # React frontend (coming soon)
├── docker/                    # Docker configurations
└── docs/                      # Documentation
    └── architecture/          # Design documents
```

---

## 🔧 Configuration

### Gitea Actions Mode

Set these secrets in your Gitea repository:

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENAI_API_KEY` | * | OpenAI API Key |
| `ANTHROPIC_API_KEY` | * | Anthropic API Key |
| `MODEL` | No | Model to use (default: `claude-sonnet-4-20250514`) |

*At least one AI provider key required

### Platform Mode

Environment variables (see `docker/.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | `file:./data/review.db` | SQLite or PostgreSQL URL |
| `JWT_SECRET` | Yes | - | JWT signing secret |
| `ADMIN_PASSWORD` | No | `admin123` | Initial admin password |
| `OPENAI_API_KEY` | * | - | OpenAI API Key |
| `DEFAULT_MODEL` | No | `gpt-4o-mini` | Default AI model |
| `CORS_ORIGINS` | No | `localhost` | Allowed CORS origins |

---

## 📖 API Reference

Platform mode exposes a RESTful API:

### Authentication
```
POST   /api/v1/auth/login          # Login with username/password
POST   /api/v1/auth/refresh        # Refresh JWT token
GET    /api/v1/auth/me             # Get current user
```

### Repositories
```
GET    /api/v1/repositories        # List repositories
POST   /api/v1/repositories        # Add repository
GET    /api/v1/repositories/:id    # Get repository
PATCH  /api/v1/repositories/:id    # Update repository
DELETE /api/v1/repositories/:id    # Delete repository
POST   /api/v1/repositories/:id/test  # Test connection
```

### Reviews
```
GET    /api/v1/reviews             # List reviews
GET    /api/v1/reviews/stats       # Get statistics
GET    /api/v1/reviews/:id         # Get review details
POST   /api/v1/reviews/:id/retry   # Retry failed review
```

### Templates
```
GET    /api/v1/templates           # List templates
POST   /api/v1/templates           # Create template
GET    /api/v1/templates/:id       # Get template
PATCH  /api/v1/templates/:id       # Update template
DELETE /api/v1/templates/:id       # Delete template
```

### Webhooks
```
POST   /api/v1/webhooks/:provider/:repoId   # Receive webhook
```

### System
```
GET    /api/v1/system/health       # Health check
GET    /api/v1/system/info         # System info
GET    /api/v1/system/models       # Available AI models
```

---

## 🔄 Webhook Setup

### For Gitea/Forgejo

1. Go to Repository → Settings → Webhooks → Add Webhook
2. Set Payload URL to: `https://your-server/api/v1/webhooks/gitea/{repository_id}`
3. Set Content Type to: `application/json`
4. Set Secret to the value from your repository config
5. Select events: Pull Request, Pull Request Comment

### For GitHub

1. Go to Repository → Settings → Webhooks → Add webhook
2. Set Payload URL to: `https://your-server/api/v1/webhooks/github/{repository_id}`
3. Set Content Type to: `application/json`
4. Set Secret and select Pull request events

---

## 🛠️ Development

### Prerequisites
- [Bun](https://bun.sh) >= 1.0
- Node.js >= 18 (optional, for compatibility)

### Setup

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build

# Run tests
bun run test
```

### Project Structure

| Package | Description | Status |
|---------|-------------|--------|
| `@opencode-review/core` | Provider abstraction, events, templates | ✅ Complete |
| `@opencode-review/server` | Hono API server | ✅ Complete |
| `@opencode-review/web` | React web UI | 🔜 Coming soon |

---

## 📊 Roadmap

### ✅ Phase 1: Core Infrastructure (Completed)
- [x] Gitea Actions integration (original CLI mode)
- [x] Docker support for CLI mode
- [x] Monorepo architecture with Turborepo
- [x] Provider abstraction layer (`GitProvider` interface)
- [x] GiteaProvider implementation
- [x] Webhook event parsing & normalization
- [x] Template system with built-in presets

### ✅ Phase 2: Backend Platform (Completed)
- [x] Hono + Bun HTTP server
- [x] SQLite + Drizzle ORM database
- [x] JWT + API Key authentication
- [x] Repository management API
- [x] Template CRUD API
- [x] Review history API with statistics
- [x] Webhook receiver endpoints
- [x] System health & config API

### 🔄 Phase 3: In Progress
- [x] ReviewEngine framework (40% - SDK integration pending)
- [x] Docker deployment configs (70% - frontend pending)
- [ ] Web UI (React + Shadcn/UI + TailwindCSS)
- [ ] OpenCode SDK integration

### 📋 Phase 4: Future
- [ ] GitHub Provider
- [ ] GitLab Provider
- [ ] OAuth integration (Gitea/GitHub/GitLab)
- [ ] Review analytics dashboard
- [ ] Slack/Discord notifications
- [ ] Self-hosted AI model support (Ollama)

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

---

## 📄 License

[MIT License](LICENSE)

---

## 🔗 Links

- [OpenCode](https://opencode.ai) - The AI coding assistant
- [Architecture Docs](docs/architecture/) - Detailed design documents
- [API Design](docs/architecture/api-design.md) - Full API specification
