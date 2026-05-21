---
name: commit-with-spec
description: Enforce the Ship-Commit-Track cycle — verify SPEC.md and CHANGELOG.md updates, then commit using the F-XXX format. Use after completing any unit of work (feature, fix, refactor) before the user asks for a commit.
argument-hint: <type>(<scope>): <summary>  [e.g. "feat(mluxe): add streaming support"]
---

# Commit With Spec

Enforces the project's Ship-Commit-Track cycle. Run this BEFORE every commit — do not wait to be asked.

## Pre-commit checklist (must verify in order)

1. **`.ai/SPEC.md` updated**
   - Did the change add/modify a feature, package, or backlog item?
   - Confirm a `[SHIPPED]`, `[PARTIAL]`, or `[IN_PROGRESS]` status tag exists with a stable F-XXX ID
   - If new work was identified, ensure it's in §2 with `[PLANNED]`

2. **`.ai/CHANGELOG.md` entry added**
   - Today's date heading + bullet describing the change
   - Cross-references the same F-XXX ID

3. **Lint clean**
   - TS/JS changes: `pnpm -r run lint`

4. **Commit format**
   - Type: feat | fix | refactor | docs | chore | perf | test
   - Scope: api | web | cli | mluxe | infra | spec
   - Body explains WHY (not how)
   - `Spec: F-XXX` line
   - `Closes: F-XXX` if fully shipped
   - `Co-Authored-By: <agent> <noreply@anthropic.com>`

## Commands

```bash
# 1. Show what's about to be committed
git status
git diff --stat HEAD

# 2. Verify SPEC + CHANGELOG were touched alongside code
git diff --name-only HEAD | grep -E '\.ai/(SPEC|CHANGELOG)\.md' || \
  echo "WARNING: code changed but SPEC/CHANGELOG not updated — fix before committing"

# 3. Commit
git commit -m "<type>(<scope>): <summary>

<body — what and why>

Spec: F-XXX
Closes: F-XXX

Co-Authored-By: <agent> <noreply@anthropic.com>"
```

## Hard rules

- **One commit per unit of work.** Do not batch unrelated changes.
- **Never push** unless the user explicitly asks.
- If the SPEC/CHANGELOG check warns and the work is non-trivial, STOP and update them.

## When the work is trivial enough to skip SPEC

Only `chore(infra): ...` or `docs(spec): ...` self-referential commits skip the SPEC update — and they still go in CHANGELOG.
