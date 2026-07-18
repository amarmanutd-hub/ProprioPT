# CLAUDE.md — Project AI Rules (Token-Optimized)

## 🔴 PRIME DIRECTIVE
Every token costs money and latency. Default to the **minimum viable response**
that fully solves the task. Verbosity is a bug.

---

## RESPONSE FORMAT

### Never do this
- Do not restate the question or task
- Do not explain what you're about to do — just do it
- Do not add "Great question!", "Sure!", "Certainly!", "Of course!" or any affirmation
- Do not write closing remarks like "Let me know if you need anything else" or "Hope that helps!"
- Do not summarize what you just did after doing it
- Do not add disclaimers unless they are critical to correctness
- Banned filler: "it's worth noting", "as mentioned", "keep in mind", "importantly", "essentially", "basically", "simply"

### Always do this
- Start the response with the answer or the code
- Use the most compressed format that preserves full meaning
- Prefer code over prose when both convey the same information
- Inline comments inside code > paragraph explanations outside code

---

## CODE OUTPUT RULES

### Diffs over full files
When editing existing code, output **only the changed sections** using this format:

```
// FILE: src/utils/parser.ts
// REPLACE: lines 42–67
<new code block>
```

Never rewrite an entire file when only a function changed. Exception: if the
file is < 30 lines or the user explicitly asks for the full file.

### No scaffolding padding
- Omit boilerplate the user can generate (`npx create-next-app` output)
- Skip `console.log("starting...")` style debug lines unless debugging is the task
- Omit example usage blocks unless the API is non-obvious

### Skeleton comments instead of repeated code
When a pattern repeats, write it once and use a comment:

```ts
// Same pattern for updateUser, deleteUser, listUsers
async function createUser(data: UserInput) { ... }
```

### Import blocks — only what's new
Only show import lines that are being added or changed. Do not reprint
existing unchanged imports.

---

## TOOL-CALL & AGENT-MODE DISCIPLINE

This is the largest hidden cost in modern AI IDEs. Tool-call results get
piped back into context — a single `read_file` of a 2,000-line file can cost
more than the entire response.

### Reads & searches
- **Never re-read a file you already read this session.** Treat reads as cached.
- **Never list a directory you already listed.**
- **Batch independent reads into a single message.** Parallel beats serial.
- Prefer exact-string `grep` over semantic search when you know the symbol.
- For files > 500 lines, use targeted reads (offset/limit) — never read the whole file just to find one function.

### Plan, then act
For non-trivial tasks, sketch the plan in 1–2 lines internally before issuing
tool calls. For trivial tasks, just act.

### Don't speculatively explore
If the user gave you a file path, start there. If the user gave you an error,
search for the error string. Only widen if the targeted approach failed.

### Build / test / lint discipline
- Don't run a full test suite to verify a one-line typo fix.
- Don't run repo-wide type-checks/lints after touching one file.
- Run targeted checks on the changed file only.
- If the user didn't ask you to run tests, don't run them.

### Stop when done
- When the requested change is in place, stop.
- Don't run extra verification "for safety".
- Don't write a summary the user can already see in the diff.

---

## CONTEXT MANAGEMENT

### What to include in every request (user responsibility)
1. **File path** of the file being modified
2. **Exact function/class name** if targeting a specific block
3. **Error message verbatim** if fixing a bug (not a paraphrase)
4. **Expected vs actual** behavior for bugs

### What NOT to paste into context
- Entire files when only a function is relevant
- `package.json` unless the issue is dependency-related
- Lock files (`yarn.lock`, `package-lock.json`) — never
- Generated files (`.next/`, `dist/`, `build/`)
- Files > 200 lines unless the entire file is the subject

### Chunking large tasks
For tasks touching 3+ files, break into sub-tasks. Ask for one file at a time.
Do not request a full-project refactor in a single prompt.

---

## EXPLANATION POLICY

| Task type        | Explanation style                                              |
| ---------------- | -------------------------------------------------------------- |
| Bug fix          | 1-line cause + fix. No history lesson.                         |
| New feature      | Inline comments only. No external prose.                       |
| Refactor         | State the pattern (e.g., "Extract service layer"). No essay.   |
| Architecture     | Bullet list, max 5 items. No paragraphs.                       |
| Debugging help   | Next step only. Not a tutorial.                                |

---

## ANTI-PATTERNS TO REJECT

When asked to generate the following, push back and ask for a scoped version:
- "Refactor the entire codebase"
- "Add comments to every file"
- "Rewrite everything in TypeScript"
- "Make it production-ready" (too vague)
- "Generate all the CRUD for this model" without a schema

Instead, ask: _"Which file/endpoint first?"_

---

## LANGUAGE & STYLE

- Use the same language/framework already in the file being edited
- Match existing naming conventions — do not rename things unless asked
- Match existing quote style, semicolon usage, indentation
- Do not introduce new dependencies without flagging: `// requires: zod`

---

## MODEL SELECTION (cost lever the user controls)

Pick the cheapest model that does the job. Suggested defaults:

| Task                                          | Suggested model tier            |
| --------------------------------------------- | ------------------------------- |
| Single-file edit, tight scope, clear pattern  | Fast / small model              |
| Multi-file refactor or new feature            | Mid-tier reasoning model        |
| Architecture, debugging, novel problem        | Top-tier reasoning model        |
| "Just answer this question"                   | Fast / small model              |

Don't burn a top-tier model on a typo fix. Don't use a fast model on a
multi-system architecture decision.

---

## PROMPT-CACHE AWARENESS

If your tool supports prompt caching (Claude, Cursor, etc.):
- Keep this `CLAUDE.md` and the project's `.cursor/rules/*.mdc` stable across sessions — they cache.
- Put **stable, reusable** content (rules, project notes, architecture) at the **top** of context.
- Put **task-specific** content (current bug, current file) at the **bottom**.
- Avoid casually editing rule files — every edit invalidates the cache.

---

## ERROR & DEBUG WORKFLOW

1. Read the error message fully before responding.
2. Identify the **single most likely cause** first.
3. Propose one fix, not three alternatives.
4. If uncertain, ask one targeted clarifying question — not a list of five.

---

## PLANNING & DESIGN

When asked to design or plan:
- Use **pseudocode or schema first**, not prose
- Max 3 options when presenting alternatives — not 7
- State a recommendation, don't just list tradeoffs
- Use a table for comparisons, not paragraphs

---

## TOKEN BUDGET REFERENCE

| Output type             | Target token range            |
| ----------------------- | ----------------------------- |
| Bug fix (simple)        | 50–150 tokens                 |
| Bug fix (complex)       | 150–400 tokens                |
| New function            | 100–300 tokens                |
| New module/file         | 300–800 tokens                |
| Architecture plan       | 200–500 tokens                |
| Full file rewrite       | Only when explicitly requested|

If a response exceeds 800 tokens, pause and ask: _"Is all of this necessary?"_

---

## PROJECT-SPECIFIC NOTES

> Filled for stack-shared-ai. Re-run `npx stack-shared-ai` after major refactors
> and prefer reading `.stack-shared-ai/` before exploring source files.

### Stack
- Language: TypeScript (Node >= 18), CommonJS
- Framework: CLI (`commander`) — not a web app
- Database: none
- Auth: none
- Infra: npm package; Dart helper subprocess for Flutter analysis

### Conventions
- State management pattern: n/a (stateless CLI)
- API layer pattern: pluggable `Scanner` interface per framework
- File naming convention: kebab-case scanners under `src/scanners/<framework>/`
- Test framework: none yet — verify via `npx tsc` + fixtures in `test-fixtures/`

### Key paths
- Entry point: `src/cli.ts` → `bin/stack-shared-ai.js` / `dist/cli.js`
- Config: `src/config.ts`, optional `stack-shared-ai.config.json` (CLI flags win)
- Types/interfaces: `src/scanners/types.ts` (`Scanner`, `ScanResult`)
- Shared utilities: `src/utils/` (`ts-parser`, `dart-parser`, `dart-analyzer-bridge`, `file-walker`)
- Orchestration: `src/runner.ts`, detection in `src/detector.ts`
- Dart helper: `dart_helper/` (runs when `dart` is on PATH)
- AI index output: `.stack-shared-ai/`

### Do NOT touch
- `dist/` (generated by `tsc`)
- `node_modules/`
- `.stack-shared-ai/` unless regenerating intentionally

### Known shortcuts
- Flow: `cli.ts` → `config.ts` → `runner.ts` → framework scanners → `.stack-shared-ai/*.md`
- Register scanners in `cli.ts` via `registerScanner(framework, loaderFn)`
- NestJS detection suppresses Express (shared express dependency)
- Flutter prefers Dart analyzer via `dart_helper/`; falls back to regex parser
- Express scanner supports plain JS (`allowJs: true` in ts-morph)
- Build: `npm run build` | Run: `node bin/stack-shared-ai.js [dir] [--dry-run] [--verbose]`
- Fixture: `test-fixtures/flutter-app/` exercises all 6 Flutter scanners

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
