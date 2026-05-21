# pro-gram

Homebase for cutting-edge programming environment and techniques that transcend individual apps or projects.

## What This Is

A monorepo for experimentation with modern tooling, AI-native development workflows, and emerging tech. Features polyglot packages spanning TypeScript, Python (MLX), and whatever comes next.

## Structure

```text
pro-gram/
├── apps/
│   ├── api/           # Fastify + TypeScript API server
│   ├── web/           # Next.js frontend
│   └── cli/           # TypeScript CLI tools
├── packages/
│   └── mluxe/         # Apple MLX wrapper — local LLM inference on Apple Silicon
├── .ai/               # AI assistant context system (SPEC.md, skills, tool configs)
└── tsconfig.base.json # Shared strict TypeScript config
```

## Tech Stack

- **Runtime:** Node.js 24 + pnpm workspaces
- **Language:** TypeScript (strict), Python (MLX)
- **Web:** Next.js 16, React 19, Tailwind CSS
- **API:** Fastify
- **ML/AI:** Apple MLX via mluxe
- **AI Context:** Multi-agent .ai directory (Augment, Cursor, Gemini, Claude, Warp)

## Getting Started

```bash
# Prerequisites: Node.js 24+, pnpm 9.7+
nvm use
pnpm install

# Development
pnpm dev          # Start all apps in parallel
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm format       # Format with Prettier
```

## Philosophy

- **Experiment freely.** This repo is a lab, not a product.
- **AI-native.** Every agent gets first-class context via `.ai/`.
- **Spec-driven.** `.ai/SPEC.md` is the living source of truth.
- **Cutting edge.** Node 24, React 19, Apple Silicon ML — latest stable of everything.

## License

MIT
