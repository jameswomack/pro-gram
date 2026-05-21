# pro-gram — Claude Code Context

**Project:** Polyglot experimentation monorepo
**Stack:** Fastify 5 + Next.js 16 + React 19 + Apple MLX
**Runtime:** Node.js 24 + pnpm 9.7

## Spec-Driven Development

After implementing ANY feature, update `.ai/SPEC.md` and `.ai/CHANGELOG.md`.

## Structure

```text
apps/api/          — Fastify backend
apps/web/          — Next.js frontend
apps/cli/          — TypeScript CLI
packages/mluxe/    — Apple MLX wrapper (local LLM inference)
.ai/               — AI context (SPEC.md, skills, tool-configs)
```

## Conventions

- TypeScript strict mode, no `any`
- Zod validation on all inputs
- Structured error responses: `{ error: { code, message, statusCode } }`
- Vitest for testing, co-located `.test.ts` files
- Commit format: `<type>(<scope>): <summary>` with `Spec: F-XXX`

## References

- `.ai/SPEC.md` — Living specification
- `.ai/skills/coding-standards.md` — Full coding standards
