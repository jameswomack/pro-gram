# pro-gram — Gemini Code Assist Context

**Project:** Polyglot experimentation monorepo — cutting-edge programming environment and techniques
**Stack:** TypeScript monorepo (Fastify 5 + Next.js 16 + React 19) + Apple MLX
**Runtime:** Node.js 24 + pnpm 9.7 workspaces

---

## Mandatory: Spec-Driven Development

**After implementing ANY feature, you MUST update `.ai/SPEC.md`:**

1. Update feature status from `[PLANNED]` → `[SHIPPED]`
2. Add new packages if created
3. Add a CHANGELOG entry in `.ai/CHANGELOG.md`

SPEC.md is the single source of truth. If you don't update it, the next agent starts from a lie.

---

## Quick Reference

### Project Structure

- `apps/api/` — Fastify 5 backend
- `apps/web/` — Next.js 16 frontend
- `apps/cli/` — TypeScript CLI tools
- `packages/mluxe/` — Apple MLX wrapper for local LLM inference
- `.ai/` — AI assistant context files (this directory)

### Key Commands

```bash
pnpm dev              # Start all apps
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm format           # Format with Prettier
```

---

## Technology Guidelines

### TypeScript

- Strict mode enabled
- No `any` types
- Explicit return types
- Zod for validation

### API (Fastify 5)

- RESTful endpoints under `/api/`
- Structured error responses
- Input validation with Zod

### Frontend (Next.js 16)

- App Router (Server Components by default)
- React 19
- TypeScript (strict)

---

## Code Style

### Naming Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Error Handling

```typescript
// Backend
return reply.code(404).send({
  error: {
    code: 'NOT_FOUND',
    message: 'Descriptive message',
    statusCode: 404
  }
});
```

---

## Testing

- Framework: Vitest
- Location: Co-located with source (`.test.ts`)
- Coverage: 80%+ for critical paths

---

## References

- **Architecture:** `.ai/SPEC.md`
- **Coding Standards:** `.ai/skills/coding-standards.md`

---

End of Gemini Context
