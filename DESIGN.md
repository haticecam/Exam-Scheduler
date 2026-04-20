# Design System — Linear Signal

> **AGENTS — READ THIS FIRST:**
> - This file is the **single source of truth** for all visual design decisions in Exam Scheduler.
> - Read this before writing any UI code.

---

## 1. Philosophy: Calm Operational Clarity

Visual benchmark: **Linear's product workspace** — dense enough for serious work, restrained enough to disappear behind the task, polished enough to signal product maturity.

**Principles:**
- **Signal over decoration** — use contrast, spacing, and motion to indicate priority. No gradients or ornamental details.
- **Tonal depth, not borders** — surfaces separate by tone shift, not lines.
- **One accent** — orange drives focus, active navigation, and primary actions. Status colors are reserved for PDLC meaning.
- **Compact density** — favor compact spacing and crisp labels. Tighter than a marketing site, never cramped.

---

## 2. Themes

Two themes: **dark** (default) and **light**. Managed by `next-themes` with `attribute="class"` and `defaultTheme="system"`. The `dark` class on `<html>` activates dark mode; absent class activates light mode.

In `globals.css`:
- `:root` = light theme tokens (default)
- `.dark` = dark theme overrides

---

## 3. Color Tokens

### Dark Theme (`.dark`)

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#0e0e0e` | Application canvas |
| `--surface-container-low` | `#131313` | Navigation rails, grouped zones |
| `--surface-container` | `#181818` | Cards, editors, forms |
| `--surface-container-high` | `#1e1e1e` | Active / hover containers |
| `--surface-container-highest` | `#252525` | Dialogs, menus, drawers |
| `--surface-bright` | `#2d2d2d` | Hover highlight |
| `--on-surface` | `#fafaf9` | Primary text |
| `--on-surface-variant` | `#a1a1aa` | Secondary text, quiet icons |
| `--outline-variant` | `#363636` | Ghost borders (use at 20–40% opacity) |
| `--primary` | `#f97316` | Accent — focus, active nav, primary actions |
| `--primary-container` | `#4f2408` | Accent background tint |
| `--primary-foreground` | `#18110b` | Text on accent fill |
| `--secondary` | `#1e1e1e` | Elevated neutral surface |
| `--secondary-foreground` | `#fafaf9` | Text on secondary |
| `--input` | `#0e0e0e` | Input/textarea background fill |

### Light Theme (`:root`)

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#f9fafb` | Application canvas |
| `--surface-container-low` | `#f3f4f6` | Navigation rails, grouped zones |
| `--surface-container` | `#ffffff` | Cards, editors, forms |
| `--surface-container-high` | `#eaecf0` | Active / hover containers |
| `--surface-container-highest` | `#e5e7eb` | Dialogs, menus, drawers |
| `--surface-bright` | `#ffffff` | Hover highlight |
| `--on-surface` | `#111827` | Primary text |
| `--on-surface-variant` | `#6b7280` | Secondary text, quiet icons |
| `--outline-variant` | `#e5e7eb` | Ghost borders |
| `--primary` | `#f97316` | Same — accent is theme-invariant |
| `--primary-container` | `#ffedd5` | Accent background tint |
| `--primary-foreground` | `#18110b` | Text on accent fill |
| `--secondary` | `#f3f4f6` | Elevated neutral surface |
| `--secondary-foreground` | `#111827` | Text on secondary |
| `--input` | `#ffffff` | Input/textarea background fill |

### Semantic Status (both themes)

| Token | Value | Meaning |
|---|---|---|
| `--status-info` | `#66b3ff` | Discovery / informational |
| `--status-planning` | `#b197fc` | Planning / shape |
| `--status-success` | `#4ade80` | Shipped / healthy |
| `--status-warning` | `#fbbf24` | At risk / waiting |
| `--status-danger` | `#f87171` | Blocked / destructive |

Semantic badges: low-opacity fill + full-opacity text or colored dot.

> Semantic status tokens use the same hex values in both themes. In `globals.css`, define them in `:root` only (not duplicated in `.dark`).

---

## 4. Typography

Font: **Inter** (loaded via `next/font/google` as `--font-sans`). Strict, system-like hierarchy.

| Class | Size | Weight | Tracking | Usage |
|---|---|---|---|---|
| `.text-display` | 2rem | 700 | -0.04em | Page titles only |
| `.text-title-lg` | 1.25rem | 600 | -0.03em | Section headers |
| `.text-title-md` | 1rem | 600 | -0.02em | Card headers, panel titles |
| `.text-body-md` | 0.875rem | 400 | normal | Descriptions, list content |
| `.text-body-sm` | 0.75rem | 400 | normal | Metadata details |
| `.text-label-sm` | 0.6875rem | 600 | normal | Labels |
| `.text-group-header` | 0.6875rem | 600 | 0.12em | Uppercase group labels (sparingly) |

Rules:
- These are custom utility classes defined in `src/app/globals.css` `@layer utilities`. Use them as `className="text-display"` etc. in JSX — they are not Tailwind built-ins.
- Prefer semibold (600) over bold (700) for most UI.
- Keep headings short and functional.
- Use `.text-group-header` only for scan landmarks — uppercase is a strong signal.

---

## 5. Spacing

Base unit: **8px**.

| Value | Tailwind | Usage |
|---|---|---|
| 4px | `gap-1` / `p-1` | Dense inline gaps |
| 8px | `gap-2` / `p-2` | Icon-label spacing |
| 12px | `gap-3` / `p-3` | Controls, stacked metadata |
| 16px | `p-4` | Card padding minimum |
| 24px | `p-6` | Section rhythm |
| 32px+ | `p-8` | Page-level breathing room only |

---

## 6. Radius

| Context | Value | Tailwind |
|---|---|---|
| Controls (buttons, inputs, badges) | 8px | `rounded-lg` |
| Cards, panels | 12px | `rounded-xl` |
| Dialogs, drawers | 14px | `rounded-[14px]` |

Never use `rounded-full` unless explicitly a badge or segmented control pill.

The base `--radius` CSS variable is `0.5rem` (8px), defined in `:root` only — it is theme-invariant. The `@theme inline` block derives `--radius-sm` through `--radius-4xl` from it. Do not override `--radius` in `.dark`.

---

## 7. Motion

| Property | Value |
|---|---|
| Duration | 140ms–180ms |
| Easing | `ease-out` |
| Hover states | Color / border / background shifts only — no scaling |
| Card/button scale on hover | Prohibited — causes layout instability |

Always respect `prefers-reduced-motion`.

---

## 8. Component Rules

### Buttons
- **Primary (`default` variant):** orange fill, dark foreground — one per region max
- **Outline (`outline` variant):** transparent + subtle border — secondary actions
- **Ghost (`ghost` variant):** text-first — toolbars, dense surfaces, nav items
- **Destructive:** red fill — irreversible actions only
- No gradient buttons. `bg-accent-gradient` is **prohibited**.
- No oversized shadows.
- For link-as-button: `<Link href="…" className={cn(buttonVariants({ variant: "ghost" }))}>` — never `<Button asChild>`.

### Inputs & Textareas
- Fill: `var(--input)` (set to surface canvas)
- Default border: `var(--outline-variant)` — quiet but visible
- Focus: accent border + subtle ring. No bright glows or oversized halos.
- Use shared `Input` and `Textarea` primitives from `src/components/ui/`. Never build one-off inputs.

### Cards & Panels
- Sit on `surface-container` with faint `outline-variant` border
- Hover: raise contrast slightly (background shift), never "jump" or scale
- Footer / toolbar: `surface-container-high`
- Use `rounded-xl` (12px) radius

### Badges
- Default: low-intensity accent tint
- Semantic: muted fill + readable text using status tokens
- Never use badges as decoration — they carry meaning

### Drawers & Dialogs
- Background: `surface-container-highest`
- Drawer width: 440px standard, 480px for content-heavy drawers (e.g., full form with multiple sections)
- Overlay: dim + light blur — not strong shadows
- Radius: `rounded-[14px]`

### Scrollbars
- Style scrollbars globally at the theme level instead of per-component overrides
- Keep them thin, low-contrast, and transparent-backed so they recede until needed
- Thumb should use `outline-variant` at low opacity and strengthen slightly on hover
- Track should remain transparent

### Sidebar & Navigation
- Background: `surface-container-low` (sidebar token)
- Persistent and quiet — never competes with content
- Active item: apply `text-primary` (`color: var(--primary)`) to the icon and label. Optionally add a 2px left border in `primary`. Never fill the entire row background with the accent color.
- No borders on the sidebar itself — tonal separation only

### Tables & Lists
- No hard separators between every row — prefer whitespace grouping
- Row hover: subtle background shift to `surface-container-high`
- For interactive list items (nav items, command palette rows): use `surface-bright` on hover. For card hover, use `surface-container-high`.
- Sticky headers: sit on `surface-container-low`

---

## 9. Layout Patterns

### Surface Hierarchy (prefer tone over dividers)
```
background → surface-container-low → surface-container → surface-container-high → surface-container-highest
```

### Page Shell
- Reuse `src/components/workspace/workspace-page-shell.tsx` for page headers and section rhythm
- Page header: strong title (`.text-display`) + muted summary (`.text-body-md` in `on-surface-variant`)
- Sections: stacked with 24px rhythm. No visible dividers between sections.

---

## 10. Dos & Don'ts

### Do
- Build hierarchy with typography and spacing before reaching for color or borders
- Use one accent (`--primary`) to show focus and action
- Prefer `surface-container-low` → `surface-container` → `surface-container-high` → `surface-container-highest` for depth
- Make hover and focus states obvious for keyboard and pointer users

### Don't
- Use gradient buttons — `bg-accent-gradient` is prohibited
- Let every card, badge, or icon carry a highlight color
- Use thick borders and shadows together
- Import from `@radix-ui/*` — this project uses `@base-ui/react` exclusively
- Add `asChild` prop to any component — it does not exist in this version
- Use `<Button asChild>` — use `buttonVariants()` + `<Link>` instead
- Add `export const dynamic = "force-dynamic"` to individual pages — the dashboard layout already sets it

---

## 11. Sync Instructions (for agents)

When this file is updated, sync `src/app/globals.css` as follows:

1. Map Section 3 color tokens to CSS custom properties
2. `:root` block = **light theme tokens** (Section 3 — Light Theme table)
3. `.dark` block = **dark theme tokens** (Section 3 — Dark Theme table)
4. If component rules add or change global primitives such as scrollbar styling, sync that in `@layer base`
5. Run `pnpm tsc --noEmit` — expected: no errors
6. Run `pnpm dlx ultracite fix` — expected: no changes needed
