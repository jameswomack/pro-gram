# .ai/ Directory — AI Assistant Context System

**Purpose:** Centralized knowledge base for AI coding assistants (Augment, Gemini, Warp, Claude Code, GitHub Copilot, Cursor)

**Last Updated:** 2026-05-21

---

## Directory Structure

```text
.ai/
├── README.md                          # This file
├── INDEX.md                           # Quick navigation guide
├── SPEC.md                            # Living specification & feature registry
├── CHANGELOG.md                       # Change log
├── shared/                            # Shared context for all agents
├── session-history/                   # AI agent conversation history
├── skills/                            # Coding standards & reusable skills
│   ├── coding-standards.md            # TypeScript, React, API conventions
│   └── commit-with-spec/SKILL.md      # Ship-Commit-Track cycle
├── tool-configs/                      # AI tool-specific configurations
│   ├── augment-rules.md               # Augment Code rules
│   ├── gemini-context.md              # Gemini Code Assist context
│   └── cursor-rules.md                # Cursor IDE rules
├── features/                          # Feature specs and research
├── specs/                             # Detailed design specs
└── plans/                             # Implementation plans
```

---

## How AI Tools Access This Context

### Augment Code

- **Primary:** `.augment/rules/*.md` (symlinked to `.ai/tool-configs/augment-rules.md`)
- **Usage:** Rules are automatically loaded into context for all agent interactions

### Gemini Code Assist

- **Primary:** `GEMINI.md` in project root (symlinked to `.ai/tool-configs/gemini-context.md`)
- **Usage:** Context file provides project-specific instructions

### Cursor IDE

- **Primary:** `.cursorrules` in project root (symlinked to `.ai/tool-configs/cursor-rules.md`)
- **Usage:** Rules applied to all AI interactions in Cursor

### Claude Code

- **Primary:** `CLAUDE.md` in project root (symlinked to `.ai/shared/claude-context.md`)
- **Usage:** Context files loaded automatically

### Warp AI Terminal

- **Primary:** Reads `.ai/` directory, SPEC.md, skills
- **Usage:** Context provided via prompts and rules

---

## Symlink Setup

```bash
# Claude Code
CLAUDE.md → .ai/shared/claude-context.md

# Gemini Code Assist
GEMINI.md → .ai/tool-configs/gemini-context.md

# Cursor IDE
.cursorrules → .ai/tool-configs/cursor-rules.md
```

**Benefits:**

- Single source of truth (`.ai/` directory)
- Updates propagate to all tools automatically
- Version controlled in one location

---

## Usage Guidelines for AI Assistants

### When Starting a New Task

1. **Read `SPEC.md`** for architecture context and feature registry
2. **Check `coding-standards.md`** for style guidelines
3. **Review feature files** in `.ai/features/` for relevant context

### When Making Changes

1. **Follow coding standards** (TypeScript strict mode, naming conventions)
2. **Respect existing patterns** in the codebase
3. **Update SPEC.md** after implementing features
4. **Add CHANGELOG entry** for shipped work

### When Uncertain

1. **Search codebase** for similar implementations
2. **Ask the user** for clarification on business logic

---

## End of README
