---
description: Require TDD (Red-Green-Refactor) for packages, components, plugins, and colocated -components
paths:
  - "packages/*/src/**/*.{ts,tsx}"
  - "apps/*/src/components/**/*.{ts,tsx}"
  - "apps/*/src/plugins/**/*.{ts,tsx}"
  - "apps/*/src/routes/**/-components/**/*.{ts,tsx}"
---

Code under `packages/*/src/`, `apps/*/src/components/`, `apps/*/src/plugins/`, and colocated `-components/` must be developed with TDD.

Invoke the `superpowers:test-driven-development` skill and follow the Red → Green → Refactor cycle.

- Place test files next to the implementation: `*.test.ts` / `*.test.tsx`
- Use vitest as the test runner: `pnpm vitest run <path>` to run a single file
- Follow the progression: fake it → triangulate → obvious implementation
- Plugins are pure `run(input)` functions — test them directly, never through the runner or other plugins
