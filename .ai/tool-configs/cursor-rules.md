# Cursor Rules — pro-gram

You are an expert TypeScript developer working on a polyglot experimentation monorepo.

## Project Context

**Type:** Full-stack monorepo + ML packages
**Stack:** Fastify 5 + Next.js 16 + React 19 + Apple MLX
**Runtime:** Node.js 24 + pnpm 9.7 workspaces
**Philosophy:** Cutting-edge experimentation lab with AI-native development

## Mandatory: Spec-Driven Development

**After implementing ANY feature, you MUST update `.ai/SPEC.md`:**

1. Update feature status from `[PLANNED]` → `[SHIPPED]`
2. Add new packages if created
3. Add a CHANGELOG entry in `.ai/CHANGELOG.md`

SPEC.md is the single source of truth. If you don't update it, the next agent starts from a lie.

## Core Principles

1. **TypeScript Strict Mode:** No `any`, explicit types, null safety
2. **Error Handling:** Structured errors with codes and actionable messages
3. **Performance:** Cache aggressively, optimize imports, keep bundles lean
4. **Security:** Validate all input with Zod

## Code Style

### TypeScript

```typescript
// ✅ Good
export async function getResource(id: number): Promise<Resource | null> {
  return await db.resource.findUnique({ where: { id } });
}

// ❌ Bad
export async function getResource(id: any) {
  return await db.resource.findUnique({ where: { id } });
}
```

### React Components

```typescript
// ✅ Good — Server Component by default
export default async function Page({ params }: { params: { id: string } }) {
  const data = await fetchData(params.id);
  return <DataView data={data} />;
}

// ✅ Good — Client Component when needed
'use client';
export function SearchInput() {
  const [query, setQuery] = useState('');
  // ...
}
```

## File Organization

### Backend (apps/api)

```text
src/
├── controllers/    # Request handlers
├── routes/         # Route definitions
├── services/       # Business logic
├── types/          # TypeScript types
└── utils/          # Utilities
```

### Frontend (apps/web)

```text
app/                # Next.js pages (App Router)
components/         # React components
lib/                # Utilities
```

## Testing

- **Framework:** Vitest
- **Location:** Co-located (`.test.ts`)
- **Coverage:** 80%+ for critical paths

## References

- Architecture: `.ai/SPEC.md`
- Coding Standards: `.ai/skills/coding-standards.md`

---

**Remember:** Always follow TypeScript strict mode, validate with Zod, handle errors gracefully.
