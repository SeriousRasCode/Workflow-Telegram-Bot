# 🤖 GitHub Workflow Telegram Bot

A production-ready Telegram Bot written in TypeScript and Node.js that delivers real-time GitHub repository events (pushes, pull requests, issues, comments, releases, workflow runs, stars, forks) directly to Telegram groups, channels, or private chats with **Telegram Forum Topics** support.

---

## ✨ Features

- **🎯 Telegram Forum Topics Support**: Assign different GitHub events to specific group topics (e.g., `#commits`, `#pull-requests`, `#issues`, `#ci-cd`) or route all events to a single designated topic.
- **⚡ Dual Topic Configuration**:
  - **Direct Command Assignment**: Run `/set_topic <event>` directly inside any topic &mdash; the bot automatically detects the topic ID!
  - **Interactive Inline Buttons**: Open `/settings` inside a topic to map events or toggle preferences with a single tap.
- **🔒 Webhook Security**: Secure HMAC SHA-256 signature verification (`X-Hub-Signature-256`) against your configured GitHub webhook secret.
- **📦 Multi-Repository Routing**: Route events from multiple repositories into specific chats/topics using `/subscribe <owner/repo>` or default wildcard matching (`*`).
- **🌿 Branch Filtering**: Restrict push and workflow notifications to specific branches (e.g., `/filter_branches main master release/*`).
- **📝 Verbosity Modes**: Switch between `detailed` (lists individual commits with SHA, message, author) and `compact` (summary line + compare link).
- **🔕 Silent Mode**: Deliver notifications silently without sound/vibration (`disable_notification`).
- **💾 Zero-External-DB Persistence**: Lightweight, atomic JSON storage with automatic schema initialization.
- **🐳 Docker Ready**: Multi-stage `Dockerfile` and `docker-compose.yml` included.

---

## 📋 Supported GitHub Events

| Event Category | GitHub Event Name | Details Included |
| :--- | :--- | :--- |
| `pushes` | `push` | Commits list, short SHA, commit message, author, branch, compare link, force-push detection |
| `prs` | `pull_request` | Opened, merged, closed, reopened, review requested, base/head branches, additions/deletions, description preview |
| `issues` | `issues` | Opened, closed, reopened, assigned, labeled, title, author, labels, description preview |
| `comments` | `issue_comment` | New comments on issues or pull requests with quote preview |
| `releases` | `release` | Published releases, pre-releases, tag names, release notes snippet |
| `workflows` | `workflow_run` | CI/CD GitHub Actions completions, status (success ✅ / failed ❌), run URL |
| `stars` / `forks`| `star`, `fork` | New star notifications and fork source/target links |

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js `v20+` or `v22+` (Node.js v26 tested)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A public URL for GitHub to reach your webhook (e.g., via domain, VPS, Railway, Render, or [ngrok](https://ngrok.com/) for local development)

### 2. Installation

Clone or open the repository:
```bash
git clone <repo-url>
cd "Workflow Telegram Bot"
```

Install dependencies:
```bash
npm install
```

### 3. Environment Configuration

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure the following variables in `.env`:
```ini
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
WEBHOOK_SECRET=your_super_secret_github_webhook_token
PORT=3000
BASE_URL=https://your-bot-domain.com
DEFAULT_VERBOSITY=detailed
```

> **Testing locally?** You can expose port 3000 using ngrok:
> ```bash
> ngrok http 3000
> ```
> Then set `BASE_URL=https://<your-ngrok-subdomain>.ngrok-free.app` in `.env`.

### 4. Build and Run

#### Development mode (auto-reload):
```bash
npm run dev
```

#### Production build:
```bash
npm run build
npm start
```

---

## 🤖 Telegram Bot Configuration

### Step 1: Create Your Bot
1. Open [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/newbot`, choose a name and username (e.g., `MyOrgGitHubBot`).
3. Copy the HTTP API token into `TELEGRAM_BOT_TOKEN` in your `.env`.
4. In @BotFather, go to **Bot Settings** &gt; **Group Privacy** &gt; **Turn off** (so the bot can read commands in groups).

### Step 2: Add Bot to Your Group
1. Add your bot to your Telegram Group.
2. Promote the bot to **Administrator** or grant it permissions to:
   - **Send Messages**
   - **Manage Topics** (if your group uses Forum Topics)

### Step 3: Assign Topics (Inside Group Topics)

If your group has **Topics (Forum)** enabled:
1. Navigate into the specific topic where you want notifications.
2. Send one of the assignment commands:
   - `/set_topic all` &mdash; Routes **all** GitHub events to this topic.
   - `/set_topic pushes` &mdash; Routes only git pushes/commits here.
   - `/set_topic prs` &mdash; Routes only pull requests here.
   - `/set_topic issues` &mdash; Routes only issues here.
   - `/set_topic releases` &mdash; Routes only releases here.
   - `/set_topic workflows` &mdash; Routes only CI/CD GitHub Actions here.
   - `/set_topic comments` &mdash; Routes issue/PR comments here.
   - `/set_topic stars` &mdash; Routes stars & forks here.

Or open the interactive UI:
- Send `/settings` inside the topic and click **"🎯 Assign This Topic"** to map it with a single click.

---

## 🐙 GitHub Webhook Setup

1. In your GitHub repository, go to **Settings** &gt; **Webhooks** &gt; **Add webhook**.
2. Set the fields:
   - **Payload URL**: `https://<YOUR_BASE_URL>/webhook`
   - **Content type**: `application/json`
   - **Secret**: The exact string you put in `WEBHOOK_SECRET` in `.env`.
   - **SSL verification**: Enable SSL verification.
3. Under **Which events would you like to trigger this webhook?**:
   - Choose **"Let me select individual events"** and check:
     - [x] Pushes
     - [x] Pull requests
     - [x] Issues
     - [x] Issue comments
     - [x] Releases
     - [x] Workflow runs
     - [x] Stars
     - [x] Forks
4. Click **Add webhook**.
5. GitHub will send a test `ping` event. You will see a green checkmark in GitHub and the bot will post a connection confirmation message!

---

## 💬 Bot Commands Reference

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/settings` | Opens the interactive settings dashboard with inline buttons | Admin |
| `/status` | Displays connection details, active topics, and routing table | All |
| `/set_topic <event>` | Routes an event type (`all`, `pushes`, `prs`, `issues`, etc.) to the current topic | Admin |
| `/unset_topic <event>` | Removes topic routing for that event | Admin |
| `/subscribe <owner/repo>`| Subscribes the chat to notifications for a specific repository | Admin |
| `/unsubscribe <owner/repo>`| Unsubscribes from a repository | Admin |
| `/repos` | Lists all subscribed repositories | All |
| `/filter_branches <branches>` | Filter notifications to specific branches (e.g. `/filter_branches main develop`) | Admin |
| `/filter_branches all` | Clears branch filter (notifies on all branches) | Admin |
| `/help` | Displays command instructions | All |

---

## 🐳 Docker Deployment

Run with Docker Compose:
```bash
docker compose up -d --build
```

View logs:
```bash
docker compose logs -f
```

Persistent data (chat settings and topic mappings) is stored in `./data/settings.json` and mounted into the container.

---

## 🧪 Running Tests

The test suite covers HMAC verification, all event formatters, topic routing logic, and HTTP endpoints:
```bash
npm test
```
