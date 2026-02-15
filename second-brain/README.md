![Mission Control](cover.png)

# Mission Control

**Your AI command center.**
A sleek dashboard to monitor, chat with, and manage your [OpenClaw](https://github.com/openclaw) agents — all from your browser.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript) ![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss) ![PWA](https://img.shields.io/badge/PWA-ready-brightgreen)

---

## Quick Start

```bash
git clone https://github.com/openclaw/dashboard.git
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000` and you're in.

> **Prerequisites:** [Node.js 18+](https://nodejs.org/) and [OpenClaw](https://github.com/openclaw) installed.
> Not sure? Run `node -v` and `openclaw --version` to check.

---

## What is this?

Mission Control is a web dashboard that sits on top of [OpenClaw](https://github.com/openclaw). Think of it as the cockpit for your AI agent system.

| Feature | Description |
|---|---|
| **Dashboard** | See everything at a glance: gateway status, active agents, cron jobs, and live system stats |
| **Agents** | Visualize your agent hierarchy, models, channels, and workspaces |
| **Chat** | Talk to your OpenClaw agents directly from the browser |
| **Tasks** | Built-in Kanban board that syncs with your workspace |
| **Memory** | Edit your agent's long-term memory and daily journal |
| **Cron Jobs** | View, create, edit, enable/disable, and trigger scheduled tasks |
| **Usage** | Deep analytics on model usage, tokens, sessions, and costs |
| **Models** | Manage primary/fallback models with drag-and-drop reordering |
| **Vector Memory** | Browse and search your semantic memory (like Pinecone, but local) |
| **System** | Real-time CPU, memory, disk, skills, devices, and config management |
| **Documents** | Browse workspace docs across all agents |
| **Search** | `Cmd+K` semantic search powered by OpenClaw's vector DB |

Everything runs locally. No cloud. No data leaves your machine.

---

## Alternative: Ask Your Agent

If OpenClaw is already running, just ask:

```
Hey, install the Mission Control dashboard for me.
```

Your agent knows how to set it up.

---

## How It Works

Mission Control auto-discovers your OpenClaw installation at startup:

1. **Home directory** — finds `~/.openclaw` (or `OPENCLAW_HOME` if set)
2. **Binary** — locates the `openclaw` CLI via `which` or common install paths
3. **Agents** — reads `openclaw.json` and scans agent directories
4. **Workspaces** — discovers all workspace directories automatically

No config files to create. No paths to set. It just works.

---

## Install as a PWA (optional)

Mission Control works as a **Progressive Web App**:

1. Open `http://localhost:3000` in Chrome or Edge
2. Click the install icon in the address bar
3. Done — it now lives in your dock/taskbar

---

## Environment Variables (optional)

These are **not required** — everything is auto-discovered. Override only if needed:

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_HOME` | `~/.openclaw` | Path to your OpenClaw home directory |
| `OPENCLAW_BIN` | Auto-detected | Path to the `openclaw` binary |
| `OPENCLAW_WORKSPACE` | Auto-detected | Path to the default workspace |
| `OPENCLAW_SKILLS_DIR` | Auto-detected | Path to system skills directory |

---

## Project Structure

```
dashboard/
├── bin/
│   └── cli.mjs             # npx entry point
├── src/
│   ├── app/
│   │   ├── api/             # Backend API routes
│   │   ├── page.tsx         # Main app shell
│   │   └── layout.tsx       # Root layout + theme
│   ├── components/          # UI components
│   ├── hooks/               # React hooks
│   └── lib/
│       ├── paths.ts         # Self-discovery logic
│       └── openclaw-cli.ts  # CLI & gateway wrapper
├── public/                  # PWA manifest & service worker
├── package.json
└── next.config.ts
```

---

## FAQ

<details>
<summary><strong>"command not found: openclaw" — what do I do?</strong></summary>

Make sure OpenClaw is installed and the `openclaw` binary is in your PATH:

```bash
openclaw --version
```

If that doesn't work, [install OpenClaw first](https://docs.openclaw.ai/install).
</details>

<details>
<summary><strong>Can I run this on a remote server?</strong></summary>

Yes! Run it on any machine where OpenClaw is installed. Just make sure the port is accessible:

```bash
npx @openclaw/dashboard --port 8080
```

For remote access via SSH:

```bash
ssh -N -L 3000:127.0.0.1:3000 user@your-server
```
</details>

<details>
<summary><strong>Does this send my data anywhere?</strong></summary>

No. Everything runs locally. Mission Control talks to your local OpenClaw installation through the CLI and gateway RPC. No data leaves your computer.
</details>

<details>
<summary><strong>Can I use this with multiple OpenClaw instances?</strong></summary>

Yes — set `OPENCLAW_HOME` to point at a different instance:

```bash
OPENCLAW_HOME=/path/to/other/.openclaw npx @openclaw/dashboard --port 3001
```
</details>

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) |
| UI | [React 19](https://react.dev), [Tailwind CSS 4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://radix-ui.com) |
| AI | [Vercel AI SDK](https://sdk.vercel.ai) |
| Icons | [Lucide](https://lucide.dev) |
| Markdown | [react-markdown](https://github.com/remarkjs/react-markdown) |
| Testing | [Playwright](https://playwright.dev) |

---

## Contributing

Pull requests are welcome! If you find a bug or have a feature idea, [open an issue](https://github.com/openclaw/dashboard/issues).

---

## License

MIT
