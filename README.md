![Mission Control — OpenClaw GUI & AI Agent Dashboard](cover.png)

# Mission Control

**Your command center for [OpenClaw](https://github.com/openclaw). See everything, control everything, from one screen.**

Monitor your AI agents in real time. Chat with them. Schedule jobs. Track costs. Manage memory. All from your browser, all running on your machine.

## Please, consider supporting me and buy me a Claude Code Subscription!
[![Buy Me a Claude Code Subscription!](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-orange?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/robsanna)


**你的 [OpenClaw](https://github.com/openclaw) 指挥中心。一屏总览，一键掌控。**

实时监控你的 AI 智能体、对话、调度任务、追踪费用、管理记忆 —— 一切在浏览器中完成，一切在你的设备上运行。

[![OpenClaw GUI](https://img.shields.io/badge/OpenClaw-GUI-7c3aed?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHRleHQgeT0iMjAiIGZvbnQtc2l6ZT0iMjAiPjwvdGV4dD48L3N2Zz4=)](https://github.com/openclaw) ![AI Dashboard](https://img.shields.io/badge/AI_Agent-Dashboard-22c55e?style=flat-square) ![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Local_AI-f59e0b?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

---

## Why Mission Control?

**Stop juggling terminals.** If you're running OpenClaw, you already know the power. Mission Control gives you the picture — a single place to see what your agents are doing, how much they're costing, and whether things are healthy.

**Your data never leaves your machine.** Mission Control runs 100% locally. No cloud, no telemetry, no accounts. It's just a window into the OpenClaw system already running on your computer.

**Works instantly.** Install it, open your browser, done. Mission Control automatically finds your OpenClaw setup — no configuration, no environment files to fill out, no database to set up.

---

## The Thin-Layer Philosophy

Mission Control is **not** a separate platform. It doesn't store your data, doesn't run its own database, and doesn't try to be the source of truth.

Instead, it's a **transparent window** into OpenClaw. Every screen, every number, every status you see comes directly from your running OpenClaw system in real time. When you make a change in Mission Control, it goes straight to OpenClaw — no sync delays, no stale caches, no "refresh to see updates."

**Why this matters to you:**
- **Always accurate** — what you see is what's actually happening, right now
- **Nothing to maintain** — no database migrations, no backup scripts, no cleanup jobs
- **Impossible to break** — if Mission Control goes down, your agents keep running untouched
- **Instant setup** — no provisioning, no storage allocation, no schema upgrades between versions

Think of it like the dashboard on your car. It shows you speed, fuel, and engine status — but removing it doesn't stop the car from driving. That's Mission Control for OpenClaw.

---

## What You Get

### See Everything at a Glance
**Dashboard** gives you a live overview the moment you open it — which agents are active, gateway health, running cron jobs, and system resources (CPU, memory, disk). No clicking around to find out if things are working.

### Talk to Your Agents
**Chat** lets you have a conversation with any of your agents directly in the browser. Attach files, pick which model to use, and get streaming responses. Switch between agents without losing context.

### Organize Work Visually
**Tasks** is a built-in Kanban board (Backlog, In Progress, Review, Done) that syncs with your workspace. Drag cards between columns, see what's in flight, keep your agents focused.

### Schedule Anything
**Cron Jobs** lets you set up recurring tasks — "summarize my inbox every morning" or "check for updates every hour." Create, edit, pause, and test jobs with full run history so you can see exactly what happened.

### Know What Things Cost
**Usage** tracks every token across every model and agent. See cost breakdowns, spot which agent is burning through budget, and understand where your money goes — all with charts, not spreadsheets.

### Manage Your Agent Team
**Agents** shows your entire agent hierarchy as an interactive org chart. See who's active, which channels they're connected to, what workspace they're using, and spin up or shut down subagents on the spot.

### Keep Your Agents' Memory Sharp
**Memory** lets you view and edit your agents' long-term memory and daily journals. **Vector Search** lets you find anything in your agents' semantic memory instantly.

### Manage Models and Keys
**Models** gives you one place to see every AI model available, set up provider credentials, configure fallback chains, and switch models per agent. No more editing config files by hand.

### Monitor Health
**Doctor** runs diagnostics and shows you exactly what's healthy and what needs attention, with one-click fixes for common issues. **Gateway** status is always visible so you know your system is connected.

### Built-In Terminal
**Terminal** gives you a full command line right in the dashboard — multiple tabs, color support, no need to switch windows.

### Connect to Messaging
**Channels** configures your agents' connections to Telegram, Discord, WhatsApp, Signal, and Slack — with QR code pairing where supported.

### Browse Your Files
**Documents** lets you explore all workspace files across agents. **Search** (`Cmd+K`) gives you instant semantic search across everything.

### Stay Secure
**Security** runs audits on your setup and flags issues. **Permissions** controls what your agents are allowed to execute. **Accounts & Keys** manages all credentials in one place with proper masking.

### Go Remote
**Tailscale** integration lets you securely access your dashboard and agents from anywhere, with tunnel controls built right in.

### Crash-Proof Panels
Every section is wrapped in an **error boundary** — if one view has a problem, the rest of the dashboard keeps working. Hit Retry and you're back without reloading the whole page.

---

## Quick Start

### 1. Make sure OpenClaw is installed

```bash
# Install OpenClaw if you haven't already
curl -fsSL https://openclaw.ai/install.sh | bash

# Verify it's running
openclaw --version
```

### 2. Install Mission Control

```bash
cd ~/.openclaw
git clone https://github.com/robsannaa/openclaw-mission-control.git
cd openclaw-mission-control
./setup.sh
```

That's it. Open `http://localhost:3333` in your browser.

**Other ways to start:**

```bash
# Change the port
PORT=8080 ./setup.sh

# Development mode (no background service)
./setup.sh --dev --no-service

# Manual mode
npm install && npm run dev
```

### Run in Docker (no host Node setup)

```bash
cd ~/.openclaw/openclaw-mission-control
OPENCLAW_HOME_HOST="$HOME/.openclaw" docker compose up -d --build
```

Then open `http://localhost:3333`.

Stop it anytime:

```bash
docker compose down
```

Full Docker guide: [`docs/docker.md`](docs/docker.md)

> **Zero configuration.** Mission Control automatically finds your `~/.openclaw` directory and the `openclaw` binary. Nothing to set up.

### Let Your Agent Install It

Already talking to an OpenClaw agent? Just ask:

```
Hey, install Mission Control for me — here's the repo:
https://github.com/robsannaa/openclaw-mission-control
```

Your agent will clone it, install dependencies, and start it up.

---

## Remote Access

Running OpenClaw on a server? Access it from your laptop with SSH tunneling:

```bash
ssh -N -L 3333:127.0.0.1:3333 user@your-server
```

Then open `http://localhost:3333` on your local machine.

---

## Environment Variables (optional)

Everything is auto-detected, but you can override if needed:

| Variable | Default | What it does |
|---|---|---|
| `OPENCLAW_HOME` | `~/.openclaw` | Where your OpenClaw data lives |
| `OPENCLAW_BIN` | Auto-detected | Path to the `openclaw` command |
| `OPENCLAW_WORKSPACE` | Auto-detected | Your default workspace folder |
| `OPENCLAW_TRANSPORT` | `auto` | How to reach the gateway: `auto`, `http`, or `cli` |
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway address (for remote setups) |
| `OPENCLAW_GATEWAY_TOKEN` | _(empty)_ | Bearer token for authenticated gateway HTTP access |

---

## FAQ

<details>
<summary><strong>"OpenClaw not found" — what do I do?</strong></summary>

Make sure the `openclaw` command works in your terminal:

```bash
openclaw --version
```

If that works but the dashboard still complains, point it directly:

```bash
OPENCLAW_BIN=$(which openclaw) npm run dev
```

If `openclaw` isn't installed, [get it here](https://docs.openclaw.ai/install).
</details>

<details>
<summary><strong>Does this send my data anywhere?</strong></summary>

No. Everything runs on your machine. Mission Control talks to your local OpenClaw installation and nothing else. No analytics, no tracking, no cloud calls.
</details>

<details>
<summary><strong>Can I use this with multiple OpenClaw setups?</strong></summary>

Yes — point to a different installation:

```bash
OPENCLAW_HOME=/path/to/other/.openclaw npm run dev -- --port 3001
```
</details>

<details>
<summary><strong>Port already in use?</strong></summary>

Pick a different one:

```bash
npm run dev -- --port 8080
```
</details>

---

## Contributing

Pull requests welcome. Found a bug or have an idea? [Open an issue](https://github.com/openclaw/dashboard/issues).

---

## License

MIT
