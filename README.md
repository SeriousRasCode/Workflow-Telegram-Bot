# 🤖 GitHub Workflow Telegram Bot

A Telegram bot written in TypeScript and Node.js that delivers GitHub repository events (pushes, pull requests, issues, comments, releases, workflow runs, stars, forks) to Telegram groups, channels, or private chats with **Telegram Forum Topics** support.

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
- **💾 Single-instance persistence**: JSON storage for chat settings and recent delivery IDs. Run one bot instance with a persistent volume.
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
3. In each chat, an administrator must run `/subscribe owner/repo` for every repository whose notifications it should receive. A new chat receives no repository events by default. For an organization repository, use its full name, such as `/subscribe my-org/api`.

For broad visibility, the operator can set `PUBLIC_REPO_ALLOWLIST=public-org/*,another-org/website` in `.env`. Any group admin may then subscribe their group to an individual approved repository. For restricted repositories, use `CHAT_REPO_ALLOWLIST={"-100123456789":["private-org/api"]}` instead; `/status` shows the chat ID. Restart the bot after changing `.env`.

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
5. GitHub will send a test `ping` event. A subscribed chat will receive a connection message.

The allowlists control which repository events each chat may receive, including chats with subscriptions saved by older versions. Add only repositories intended for every group to `PUBLIC_REPO_ALLOWLIST`. This deployment uses one JSON file and one long-polling bot process; do not run multiple replicas against the same data directory or bot token.

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
| `/workflow_alerts <all|failures>` | Choose all completed CI runs or failures with recovery alerts | Admin |
| `/quiet_hours <start> <end> <timezone>` | Buffer routine notifications during local quiet hours; `/quiet_hours off` disables | Admin |
| `/digest daily <time> <timezone>` | Send routine events in a daily digest; `/digest off` disables | Admin |
| `/test` | Send a test notification and show connection readiness | Admin |
| `/delivery_status` | Show the five most recent GitHub delivery outcomes | All |
| `/help` | Displays command instructions | All |

---

## Deployment

### Cloudflare Workers deployment

The Cloudflare version uses Telegram webhooks and a D1 database. Its settings are separate from the Docker version's local JSON file.

1. Run `npm install`, then `npx wrangler login` and `npx wrangler d1 create workflow-telegram-bot`. Put the returned database ID in `wrangler.jsonc`.
2. Run `npx wrangler d1 migrations apply workflow-telegram-bot --remote`.
3. Deploy with `npx wrangler deploy --secrets-file .secrets.json`. The secret file must contain `TELEGRAM_BOT_TOKEN` and a random `TELEGRAM_WEBHOOK_SECRET`; never commit it.
4. Set the Telegram webhook to `<worker-url>/telegram`, passing `TELEGRAM_WEBHOOK_SECRET` as `secret_token`. Use the Telegram Bot API `setWebhook` method.
5. In a group or channel, run `/status` to get its chat ID. In a private chat with the bot, run `/connect <chat-id> <owner/repo>` for one repository, or `/connect <chat-id> <organization>` for an entire organization. The bot returns a unique GitHub webhook URL and secret. Add the webhook to that repository or organization. Run `/subscribe <owner/repo>` in the group or channel, or `/subscribe <chat-id> <owner/repo>` in the private chat. The subscription saves immediately; notifications begin when signed GitHub deliveries arrive.

The Cloudflare bot also supports `/disconnect <organization|owner/repo>`, `/toggle_event <event>`, `/verbosity <compact|detailed>`, and `/silent <on|off>`. In a private chat, prefix setting commands with the target chat ID. A repository administrator can configure a repository webhook, including for a personal repository. An organization owner can configure an organization webhook covering multiple repositories.

Use `/workflow_alerts failures` to notify on failed and timed-out workflow runs, then send one recovery message when the same repository, workflow, and branch succeeds. `/workflow_alerts all` keeps notifications for all completed runs. Workflow notifications must also be enabled in `/menu` or with `/toggle_event workflows`. The Node bot supports the same alert modes through `/workflow_alerts` and `/settings`.

Use `/quiet_hours 22:00 08:00 Africa/Nairobi` to hold routine notifications overnight, or `/digest daily 09:00 Africa/Nairobi` to collect them for a daily summary. The timezone must be an IANA name. CI failure and recovery alerts bypass the digest. Both deployments support `/quiet_hours off` and `/digest off`. Apply D1 migration `0004_digest.sql` before deploying this feature to Cloudflare.

Use `/test` in a group or topic to check Telegram delivery. Cloudflare also shows the number of confirmed GitHub webhook connections; a signed GitHub ping confirms a connection. Use `/delivery_status` to see whether recent signed GitHub events were delivered, queued for a digest, filtered, disabled, or failed and awaiting retry. In a private chat with the Cloudflare bot, use `/test <chat-id>` or `/delivery_status <chat-id>` for a managed group. Apply D1 migration `0005_delivery_status.sql` before deploying this feature.

Send `/menu` or `/settings` in a group or channel to open the inline management menu. Administrators can remove subscriptions, toggle events, change verbosity and silent mode, and review connections. In a forum group, open `/menu` inside a topic to assign that topic to an event. From a private chat, use `/menu <chat-id>` to manage a group or channel. Adding a repository still uses `/subscribe owner/repo` because its name must be entered as text.

Each chat has its own organization connection and webhook secret. The Cloudflare version queues notifications in D1 and sends them in batches; its free-tier limits and Telegram rate limits still apply.

### Docker deployment

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
