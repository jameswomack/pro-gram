# Coding Standards & Best Practices

**Purpose:** Guidelines for maintaining code quality and consistency across the pro-gram monorepo

---

## Definition of Done

A feature is NOT done until ALL of the following are true:

1. Code works and passes tests
2. `.ai/SPEC.md` updated (feature status, new packages, new routes)
3. `.ai/CHANGELOG.md` entry added
4. **Git commit created** — do not wait to be asked. Commit immediately after each unit of work.

The spec update and commit are part of the implementation, not a follow-up.

## Commit Message Format

```text
<type>(<scope>): <summary>

<body — what and why, not how>

Spec: <feature-ID from SPEC.md, e.g. F-001>
Closes: <feature-ID if fully shipped>

Co-Authored-By: <agent name> <noreply@anthropic.com>
```

**Types:** feat, fix, refactor, docs, chore, perf, test

**Scopes:** api, web, cli, mluxe, infra, spec

Every commit must reference a Spec ID so the git log tells the story of the product, not just the code.
One commit per unit of work. Do not batch unrelated changes.

---

## Markdown Standards

### MarkdownLint Compliance

- **Always follow MarkdownLint rules** — No violations allowed
- **Configuration:** See `.markdownlint.jsonc` in project root
- **MD040:** Fenced code blocks must have language specified (use `text` if no specific language)
- **MD047:** Files must end with a single newline
- **MD009:** No trailing spaces
- **MD010:** No hard tabs
- **MD013:** Line length max 136 chars, heading max 80 chars

---

## TypeScript Standards

### Type Safety

- **Strict Mode:** Always enabled (`strict: true` in tsconfig)
- **Explicit Types:** Prefer explicit return types for functions
- **No `any`:** Use `unknown` or proper types instead
- **Null Safety:** Use optional chaining (`?.`) and nullish coalescing (`??`)

### Naming Conventions

- **Files:** kebab-case (e.g., `mlx-client.ts`)
- **Classes:** PascalCase (e.g., `MluxeClient`)
- **Functions:** camelCase (e.g., `startServer`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT`)
- **Interfaces:** PascalCase with descriptive names (e.g., `ChatMessage`)
- **Types:** PascalCase (e.g., `ChatResponse`)

### Code Organization

```typescript
// 1. Imports (external, then internal)
import { FastifyInstance } from 'fastify';
import { someHelper } from '../utils';

// 2. Types & Interfaces
interface RequestQuery {
  name?: string;
}

// 3. Constants
const DEFAULT_LIMIT = 50;

// 4. Functions
export async function handler(query: RequestQuery) {
  // Implementation
}
```

---

## React/Next.js Standards

### Component Structure

```typescript
// 1. Imports
import { useState } from 'react';

// 2. Types
interface Props {
  items: string[];
}

// 3. Component
export function ItemList({ items }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const handleSelect = (id: number) => setSelected(id);

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} onClick={() => handleSelect(i)}>{item}</div>
      ))}
    </div>
  );
}
```

### Rules

- **Server Components** by default (Next.js App Router)
- **Client Components** only when needed (interactivity, hooks)
- **Use `use client`** directive at top of client components
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations

---

## API Design Standards

### RESTful Conventions

- **GET:** Retrieve resources (idempotent)
- **POST:** Create resources
- **PUT/PATCH:** Update resources
- **DELETE:** Remove resources

### Response Format

```typescript
// Success
{
  "data": { /* resource */ },
  "meta": { "timestamp": "2026-05-21T10:00:00Z" }
}

// Error
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "statusCode": 404
  }
}
```

### Status Codes

- **200:** Success
- **201:** Created
- **400:** Bad Request (validation error)
- **404:** Not Found
- **429:** Too Many Requests (rate limit)
- **500:** Internal Server Error

---

## Error Handling

### Backend (Fastify)

```typescript
try {
  const result = await doSomething(id);
  if (!result) {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Resource ${id} not found`, statusCode: 404 }
    });
  }
  return reply.send({ data: result });
} catch (error) {
  logger.error('Error:', error);
  return reply.code(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', statusCode: 500 }
  });
}
```

### Frontend (React)

```typescript
const { data, error, isLoading } = useQuery({
  queryKey: ['resource', id],
  queryFn: () => fetchResource(id),
  retry: 3,
  staleTime: 5 * 60 * 1000,
});

if (isLoading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;
return <ResourceView data={data} />;
```

---

## Testing Standards

### Structure

- **Location:** Co-located with source (e.g., `foo.test.ts`)
- **Coverage:** Aim for 80%+ on critical paths
- **Naming:** Descriptive test names
- **Pattern:** Arrange-Act-Assert
- **Framework:** Vitest

```typescript
describe('MluxeClient', () => {
  it('should return healthy when server is running', async () => {
    // Arrange
    const client = new MluxeClient({ model: 'test-model' });

    // Act
    const result = await client.isHealthy();

    // Assert
    expect(result).toBe(true);
  });
});
```

---

## Performance Guidelines

- **Response Time:** < 200ms for most endpoints
- **Cache aggressively** where appropriate
- **Optimize imports:** Use tree-shakeable exports
- **Bundle Size:** Keep frontend bundles lean

---

## Security Best Practices

- Never commit `.env` files
- Validate all input with Zod
- Use parameterized queries
- No sensitive data in logs

---

End of Coding Standards
