# Augment Code — Project Rules

**Project:** pro-gram
**Last Updated:** 2026-05-21

---

## Project Context

This is a polyglot monorepo for cutting-edge programming experimentation. TypeScript apps (API, web, CLI) plus Python/MLX packages for local LLM inference on Apple Silicon.

**Key Technologies:**

- Runtime: Node.js 24 + pnpm workspaces
- Backend: Fastify 5 + TypeScript (strict)
- Frontend: Next.js 16 + React 19
- CLI: tsx-based TypeScript
- ML/AI: Apple MLX via `@jameswomack/mluxe`

---

## Mandatory: Spec-Driven Development

**After implementing ANY feature, you MUST update `.ai/SPEC.md`:**

1. Update feature status from `[PLANNED]` → `[SHIPPED]`
2. Add new packages to §1 monorepo structure if created
3. Add a CHANGELOG entry in `.ai/CHANGELOG.md`

**When new work is identified or requested, add it to SPEC.md §2** with a unique ID and `[PLANNED]` status.

SPEC.md is the single source of truth. If you don't update it, the next agent starts from a lie.

---

## Core Rules

### 1. TypeScript Strict Mode

- Always use strict TypeScript (`strict: true`)
- No `any` types — use `unknown` or proper types
- Explicit return types for all functions
- Use optional chaining (`?.`) and nullish coalescing (`??`)

### 2. Error Handling

- **Backend:** Return structured errors with `code`, `message`, `statusCode`
- **Logging:** Use structured logger (never `console.log` in production code)
- **User-facing:** Provide actionable error messages

### 3. API Design

- **RESTful conventions:** GET (read), POST (create), PUT/PATCH (update), DELETE (remove)
- **Response format:** `{ data: {...}, meta: {...} }` for success
- **Input validation:** Zod schemas for all user input

### 4. React/Next.js Patterns

- **Server Components** by default (Next.js App Router)
- **Client Components** only when needed (interactivity, hooks)
- **Use `use client`** directive at top of client components

### 5. Testing

- **Unit tests** for business logic
- **Test files** co-located with source (`.test.ts` suffix)
- **Framework:** Vitest

### 6. Performance

- Cache aggressively where appropriate
- Optimize queries and imports
- Keep bundles lean

---

## References

- **Project Specification:** `.ai/SPEC.md`
- **Coding Standards:** `.ai/skills/coding-standards.md`

---

## End of Augment Rules
