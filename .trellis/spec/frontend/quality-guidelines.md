# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

`pnpm lint` (`.rules/lint.sh`) is the single quality gate, run locally and in CI (`.github/workflows/ci.yml`). It runs five checks and fails if any fails:

| Check | What it does |
|---|---|
| `tsgo -p tsconfig.check.json` | Type check |
| `biome lint` | Lint (config in `biome.json`) |
| `.rules/check.sh` | Project ast-grep rules in `.rules/*.yml`. **Any output counts as failure**, including warnings on stderr |
| `tailwindcss -i src/index.css` | CSS syntax check |
| `.rules/testBuild.sh` | Smoke build into a temp directory |

---

## Tooling Gotchas

Learned while making the repo work from a fresh clone (task `11-24-repo-hygiene`):

- **Shell scripts under `.rules/` must be committed as executable** (`git update-index --chmod=+x`). They were committed as `100644`, so `pnpm lint` failed with `Permission denied` on every fresh clone.
- **ast-grep is a dev dependency** (`@ast-grep/cli`), not a global tool. pnpm 12 blocks its postinstall by default; it is approved via `allowBuilds` in `pnpm-workspace.yaml`. Without that, ast-grep prints a fallback warning on every run, and `check.sh` treats that output as a lint failure.
- **`package.json` pins `packageManager: pnpm@12.x`**, which CI reads through `pnpm/action-setup`. Changing that field requires re-running `pnpm install` so the lockfile's `packageManagerDependencies` section updates; otherwise `pnpm install --frozen-lockfile` fails in CI.
- **Never hard-code machine-specific paths in scripts.** `testBuild.sh` used to write to `/workspace/.dist`, which only existed in the original generation sandbox.
- **Before removing a dependency, check `src/components/ui/*` and config files too**, not only business code. For example, `next-themes` is used only by `components/ui/sonner.tsx`, and `tailwind.config.js` scanned `node_modules/streamdown`.

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
