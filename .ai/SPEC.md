# pro-gram — Living Specification

> **Last Updated:** 2026-05-21
> **Status:** Alpha
> **Owner:** James Womack

This is the single source of truth for what pro-gram is, what's been built, and what's next.
All AI agents, all contributors, all planning starts here.

---

## 1. Product Overview

pro-gram is a personal monorepo and lab for cutting-edge programming environment and techniques
that transcend individual apps or projects. It features experimentation with modern tooling,
AI-native development workflows, local LLM inference, and emerging tech.

**Core thesis:** Build a reusable foundation of tools, patterns, and infrastructure that
accelerates every project — with AI agents as first-class development partners.

### Tech Stack

- **Runtime:** Node.js 24 + pnpm 9.7 workspaces
- **Language:** TypeScript (strict mode), Python (MLX)
- **API:** Fastify 5
- **Frontend:** Next.js 16, React 19
- **ML/AI:** Apple MLX via `@jameswomack/mluxe`
- **AI Context:** Multi-agent `.ai/` directory (Augment, Cursor, Gemini, Claude, Warp)

### Monorepo Structure

```text
pro-gram/
├── apps/api/          # Fastify backend
├── apps/web/          # Next.js frontend
├── apps/cli/          # TypeScript CLI tools
├── packages/mluxe/    # Apple MLX wrapper for local LLM inference
├── .ai/               # AI context system (this file lives here)
└── tsconfig.base.json # Shared TypeScript strict config
```

---

## 2. Feature Registry

### Status Key

- `[SHIPPED]` — Working
- `[PARTIAL]` — Core built, needs polish or completion
- `[PLANNED]` — Planned but no code yet
- `[IN_PROGRESS]` — Active development

### 2.1 Core Platform

| ID | Feature | Status | Key Files | Notes |
|----|---------|--------|-----------|-------|
| F-001 | MLX runtime integration (mluxe) | `[PARTIAL]` | `packages/mluxe/src/index.ts` | MluxeClient wraps mlx_lm.server with OpenAI-compatible API. Server/CLI/fine-tune modes. |
| F-002 | API server skeleton | `[SHIPPED]` | `apps/api/src/index.ts` | Fastify 5, health endpoint, Zod validation ready |
| F-003 | Web app skeleton | `[SHIPPED]` | `apps/web/` | Next.js 16, React 19, Turbopack |
| F-004 | CLI skeleton | `[SHIPPED]` | `apps/cli/src/index.ts` | tsx-based, ready for commands |
| F-005 | AI context system (.ai/) | `[SHIPPED]` | `.ai/` | SPEC.md, skills, tool-configs, multi-agent symlinks |
| F-006 | Monorepo infrastructure | `[SHIPPED]` | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | pnpm workspaces, shared TS config, Prettier, EditorConfig |

### 2.2 Planned

| ID | Feature | Priority | Status | Notes |
|----|---------|----------|--------|-------|
| F-010 | Shared utilities package (`packages/shared`) | P1 | `[PLANNED]` | Common types, helpers, constants across apps |
| F-011 | MLX benchmark suite | P1 | `[PLANNED]` | Benchmark mlx_lm vs Ollama on Apple Silicon — throughput, memory, latency |
| F-012 | LoRA fine-tuning pipeline | P2 | `[PLANNED]` | Fine-tune task-specific models via mluxe |
| F-013 | Dev environment orchestration | P2 | `[PLANNED]` | Single command to start all services, health checks, port management |

---

## 3. Architecture Patterns

### Adding a New Package

1. Create directory under `apps/` or `packages/`
2. Add `package.json` with `@jameswomack/` scope, version `1.0.0-alpha.0`
3. Add `tsconfig.json` extending `../../tsconfig.base.json`
4. Add `README.md`
5. Update this SPEC

### Adding a New Feature

1. Add to Feature Registry (§2) with unique F-XXX ID and `[PLANNED]` status
2. If non-trivial, create a feature file at `.ai/features/F-XXX-short-name.md`
3. Implement
4. Update status to `[SHIPPED]`
5. Add CHANGELOG entry

---

## 4. Post-Ship Checklist

**Every time a feature ships, the implementing agent MUST:**

1. Update the feature's status in this file (SPEC.md) from `[PLANNED]` → `[SHIPPED]`
2. Add a CHANGELOG.md entry under `[Unreleased]`
3. Update tool-config files if conventions changed

**Every time a new feature is planned or requested, the agent MUST:**

1. Add it to §2 with a unique ID
2. Set status to `[PLANNED]`
3. If scope is non-trivial, create a feature file at `.ai/features/[ID]-short-name.md`

Failure to update this spec means the next agent starts from a lie. Keep this document true.

---

*This document is the living spec. It is the canonical source of truth for what exists and what's next.
All AI agents MUST read this first and MUST update it after implementing features or identifying new work.*
