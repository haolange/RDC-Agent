# RDC-Agent Design System

**A professional workstation visual language for the RenderDoc `.rdc` debug agent.**

Design direction: restrained, high-density, dark-first, precision tool. Inspired by VS Code, JetBrains, Linear. Not decorative — every visual choice supports focus and fast triage.

---

## Token Architecture

Three layers. Always write down, never skip layers.

```
Primitive  →  --color-bg-*, --color-accent-*, --space-*
Semantic   →  --token-bg-*, --token-text-*, --token-border-*
Component  →  --btn-*, --input-*, --card-*
```

**Rule for agents:** When writing component CSS, reference `--token-*` tokens. Never use `rgb(var(--color-bg-3))` in a component — use `var(--token-bg-raised)` instead.

---

## Files

| File | Role |
|---|---|
| `styles.css` | Global CSS entry — `@import`s all token files |
| `tokens/primitives.css` | Raw color, spacing, radius, shadow values |
| `tokens/semantic.css` | Intent-named aliases: `--token-bg-*`, `--token-text-*`, `--token-border-*` |
| `tokens/components.css` | Per-component variables: `--btn-*`, `--input-*`, `--card-*`, `--modal-*` |
| `tokens/typography.css` | Font families, size scale, weights, line heights |
| `tokens/motion.css` | Easing, duration, keyframes, animation utility classes |
| `Design System Preview.html` | Interactive design system reference — open in browser |
| `screens/` | Full-screen UI specimens (Settings, Workbench, etc.) |
| `components/` | Component-level specimens |

---

## Color Usage Rules

1. **Dark background scale**: `bg-0` (darkest app bg) → `bg-5` (lightest surface). Use `--token-bg-app`, `--token-bg-shell`, `--token-bg-panel`, `--token-bg-raised` — not raw primitives.
2. **Accent (signal cyan)**: Use sparingly. Only for focus rings, active states, primary CTAs. Never as body text color.
3. **Primary (workstation blue)**: Use for brand identity (logo, primary buttons), not UI chrome.
4. **Border tokens include alpha**: `--color-border-subtle: 255 255 255 / 0.06`. Use as `rgb(var(--color-border-subtle))`. **Never** write `rgb(var(--color-border-subtle) / 0.65)` — that stacks alpha and produces invalid CSS.

---

## Typography Rules

- Body text: `var(--text-base)` / 14px, `var(--font-normal)`
- Section labels/captions: `var(--text-sm)` / 12px, `var(--token-text-caption)`
- Uppercase labels: `var(--text-xs)` + `letter-spacing: var(--tracking-caps)` + `text-transform: uppercase`
- Monospace (paths, IDs, code): `var(--font-mono)`, `var(--text-sm)`
- Never use pixel literals; always use scale variables.

---

## Button System

Single system: `.button` base class + modifier.

```html
<button class="button button-primary">Primary</button>
<button class="button button-secondary">Secondary</button>
<button class="button button-ghost">Ghost</button>
<button class="button button-danger">Danger</button>
<button class="button button-secondary button-sm">Small</button>
```

Via React `<Button>` component:
```tsx
<Button variant="primary">Primary</Button>
<Button variant="secondary" size="sm">Small</Button>
<Button variant="danger">Delete</Button>
```

---

## Migration Notes (shadcn/ui)

The target component library is **shadcn/ui** (Radix UI + Tailwind CSS). Migration steps:

1. `npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge`
2. `npx shadcn@latest init` — choose Vite, React, TypeScript
3. Map these CSS variables to shadcn/ui's CSS variable names (they use `--background`, `--foreground` etc.)
4. Use `npx shadcn@latest add button input select` etc. for components
5. Keep the existing design-system.css token layer; override shadcn variables to point at our tokens

Until migration, use the existing `.button / .input / .card` class system with semantic tokens.

---

## Spacing Rules

Use `--space-*` variables or equivalent px multiples of 4:
- Component internal padding: `--space-3` (12px) to `--space-4` (16px)
- Section gaps: `--space-4` (16px) to `--space-6` (24px)
- Tight gaps (list items): `--space-2` (8px)
- Never use odd-numbered pixel values (3px, 7px, 9px).

---

## Component Contract Template

Every new component must define:
1. **States**: rest, hover, active/pressed, focus, disabled, loading, error
2. **Variants**: via `--component-*` tokens
3. **Size variants**: sm / md / lg using height tokens
4. **Tokens used**: list the `--token-*` and `--component-*` tokens it depends on

---

## Elevation / Z-index

| Layer | Value | Usage |
|---|---|---|
| base | 0 | Normal content |
| dropdown | 100 | Dropdowns, tooltips anchored to trigger |
| sticky | 200 | Sticky headers |
| modal-backdrop | 400 | Overlay backdrop |
| modal | 500 | Dialogs, Settings modal |
| popover | 600 | Floating panels |
| tooltip | 700 | Hover tooltips |
| notification | 1000 | Toasts |
