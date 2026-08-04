# Design Guidelines — KubeDeck

> Visual system for **KubeDeck** (Kubernetes navigator), adapted from the learnX / AI Learning OS design reference.  
> Keep this file in sync when changing tokens, shell layout, or component patterns.

---

## 1. Brand Identity

**Product name:** KubeDeck  
**Tagline:** A native Kubernetes navigator — browse clusters, namespaces, and resources with a built-in terminal and AI assistant.  
**Vibe:** Calm and focused, like a tool you actually want to open. Dense but organized — every element earns its place. Dark-first, with a clean light mode fallback.

---

## 2. Color System

All colors are defined as CSS custom properties using HSL values and consumed through Tailwind's `@theme inline` block.

### Light Mode (`:root`)

| Token | HSL Value | Usage |
|---|---|---|
| `--background` | `240 10% 98%` | App background |
| `--foreground` | `240 10% 10%` | Primary text |
| `--card` | `0 0% 100%` | Card surfaces |
| `--card-foreground` | `240 10% 10%` | Text on cards |
| `--card-border` | `240 5.9% 90%` | Card borders |
| `--primary` | `262 80% 50%` | Brand violet — CTAs, active states, accents |
| `--primary-foreground` | `0 0% 100%` | Text on primary |
| `--secondary` | `240 4.8% 95.9%` | Subtle fills, secondary buttons |
| `--secondary-foreground` | `240 5.9% 10%` | Text on secondary |
| `--muted` | `240 4.8% 95.9%` | Disabled / placeholder backgrounds |
| `--muted-foreground` | `240 3.8% 46.1%` | Subdued labels, metadata |
| `--accent` | `262 80% 95%` | Light violet tint for highlights |
| `--accent-foreground` | `262 80% 40%` | Text on accent surfaces |
| `--destructive` | `0 84.2% 60.2%` | Errors, delete actions |
| `--border` | `240 5.9% 90%` | Default borders |
| `--ring` | `262 80% 50%` | Focus rings |
| `--radius` | `0.75rem` | Base border radius |

### Dark Mode (`.dark`)

| Token | HSL Value | Notes |
|---|---|---|
| `--background` | `240 10% 4%` | Near-black blue-tinted bg |
| `--foreground` | `0 0% 95%` | Near-white text |
| `--card` | `240 10% 6%` | Slightly elevated surface |
| `--card-border` | `240 10% 12%` | Subtle border |
| `--primary` | `262 80% 65%` | Lighter violet for dark bg contrast |
| `--accent` | `262 80% 15%` | Dark violet tint |
| `--muted-foreground` | `240 5% 65%` | Readable subdued text on dark |

### Sidebar Tokens (both modes)

The sidebar has its own semantic layer — always use `sidebar-*` tokens inside the sidebar, not generic `background`/`foreground`.

```css
--sidebar: 240 5.9% 98%;           /* light */  --sidebar: 240 10% 5%;    /* dark */
--sidebar-foreground: 240 10% 10%; /* light */  --sidebar-foreground: 0 0% 95%; /* dark */
--sidebar-border: 240 5.9% 90%;    /* light */  --sidebar-border: 240 10% 12%; /* dark */
--sidebar-primary: 262 80% 50%;                 /* same as --primary */
--sidebar-accent: 240 4.8% 95.9%;  /* light */  --sidebar-accent: 240 10% 12%; /* dark */
```

### Chart Palette

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `12 76% 61%` (coral) | `220 70% 50%` (blue) |
| `--chart-2` | `173 58% 39%` (teal) | `160 60% 45%` (mint) |
| `--chart-3` | `197 37% 24%` (navy) | `30 80% 55%` (amber) |
| `--chart-4` | `43 74% 66%` (gold) | `280 65% 60%` (violet) |
| `--chart-5` | `27 87% 67%` (orange) | `340 75% 55%` (rose) |

### Semantic Color Map (for course/category color-coding)

Used to assign colors to user-created items (courses, tags, etc.) by name:

```ts
const colorMap = {
  violet:  { ring: "ring-violet-500/40",  bg: "bg-violet-500/10",  text: "text-violet-400",  bar: "bg-violet-500",  card: "border-violet-500/30" },
  blue:    { ring: "ring-blue-500/40",    bg: "bg-blue-500/10",    text: "text-blue-400",    bar: "bg-blue-500",    card: "border-blue-500/30" },
  emerald: { ring: "ring-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-400", bar: "bg-emerald-500", card: "border-emerald-500/30" },
  orange:  { ring: "ring-orange-500/40",  bg: "bg-orange-500/10",  text: "text-orange-400",  bar: "bg-orange-500",  card: "border-orange-500/30" },
  rose:    { ring: "ring-rose-500/40",    bg: "bg-rose-500/10",    text: "text-rose-400",    bar: "bg-rose-500",    card: "border-rose-500/30" },
  cyan:    { ring: "ring-cyan-500/40",    bg: "bg-cyan-500/10",    text: "text-cyan-400",    bar: "bg-cyan-500",    card: "border-cyan-500/30" },
};
```

**Rule:** Always use `500/10` for background fills, `500/40` for rings, `400` for text in dark mode. The `/30` border variant keeps colored cards subtle.

---

## 3. Typography

### Font Stack

```css
--font-sans: 'Outfit', sans-serif;       /* Body, UI labels, headings */
--font-mono: 'JetBrains Mono', monospace; /* Code blocks, technical content */
```

Import via Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Or in CSS:

```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
```

### Type Scale

| Use | Classes | Notes |
|---|---|---|
| Page title | `text-2xl font-bold tracking-tight` | Dashboard H1 |
| Section heading | `text-xs font-semibold text-muted-foreground uppercase tracking-widest` | Section labels above content |
| Card title | `text-sm font-semibold` | Via `<CardTitle>` |
| Body | `text-sm` | Default content text |
| Secondary / metadata | `text-xs text-muted-foreground` | Subtitles, counts, dates |
| Micro / badge | `text-[10px] font-semibold` | Badges, status dots, pill labels |

**Key rules:**
- Never go below `text-[10px]` for legibility.
- `tracking-tight` on headings, `tracking-widest` on uppercase section labels.
- Use `font-semibold` (600) as the standard "bold" — reserve `font-bold` (700) for page-level titles and critical numbers.

---

## 4. Spacing & Layout

### Page Container

```html
<div class="p-7 max-w-7xl mx-auto space-y-7">
```

- `p-7` outer padding on all pages
- `max-w-7xl` caps content width
- `space-y-7` between top-level sections

### Grid Patterns

| Pattern | Classes |
|---|---|
| 2-col equal | `grid grid-cols-2 gap-3` |
| 2-col responsive 4 | `grid grid-cols-2 lg:grid-cols-4 gap-3` |
| 3-col with wide left | `grid grid-cols-1 lg:grid-cols-3 gap-5` (use `lg:col-span-2` on left) |
| Full-width stack | `space-y-5` or `space-y-6` |

### Border Radius Scale

```css
--radius-sm: calc(0.75rem - 4px);  /* 0.5rem  — chips, small badges */
--radius-md: calc(0.75rem - 2px);  /* 0.625rem */
--radius-lg: 0.75rem;              /* default cards, inputs */
--radius-xl: calc(0.75rem + 4px);  /* 1rem — course cards, large panels */
```

In practice: use `rounded-lg` (0.75rem) as the default, `rounded-xl` / `rounded-2xl` for hero cards and course cards, `rounded-full` for pills and badges.

---

## 5. Component Patterns

### Cards

```tsx
<Card className="border-border/50 bg-card/50 backdrop-blur shadow-sm">
  <CardHeader className="pb-3">
    <CardTitle className="text-sm font-semibold flex items-center gap-2">
      <Icon size={14} className="text-primary" /> Section Title
    </CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

**Variants:**
- **Default:** `border-border/50 bg-card/50 backdrop-blur shadow-sm`
- **Primary accent:** `border-primary/20 bg-primary/5` — for highlighted/active cards
- **Destructive accent:** `border-destructive/20 bg-destructive/5` — for warnings/alerts
- **Colored (course):** `border-{color}-500/30` + `ring-2 ring-{color}-500/40` when active

### Buttons

| Variant | Classes |
|---|---|
| Primary CTA | `bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors` |
| Secondary | `bg-secondary text-secondary-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-secondary/80 transition-colors` |
| Ghost pill (primary) | `text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full hover:bg-primary/20 transition-colors` |
| Ghost pill (neutral) | `flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-full shadow-sm text-sm` |
| Icon button | `p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground transition-colors` |
| Destructive | `bg-destructive text-destructive-foreground px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-destructive/90 transition-colors` |

### Navigation (Sidebar)

```tsx
// Active nav item
"bg-primary text-primary-foreground font-semibold"

// Inactive nav item
"text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

// Shared base
"flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-sm"
```

- Icon size: `size={16}` for nav icons
- Always use `sidebar-*` color tokens inside the sidebar

### Progress Bars

```tsx
<div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
  <div className="h-full rounded-full bg-violet-500" style={{ width: `${value}%` }} />
</div>
```

Or use the shadcn `<Progress>` component with `className="h-1.5"`.

### Status / Agent Dots

```tsx
// Active
<div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
// Glowing live indicator
<div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
// Inactive
<div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
```

### Section Labels

```tsx
<p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-1 mb-1.5">
  Section Name
</p>
```

### Empty / Add Card

```tsx
<button className="text-left p-4 rounded-2xl border-2 border-dashed border-border/40 hover:border-primary/40 bg-card/20 hover:bg-primary/5 transition-all duration-200 flex flex-col items-center justify-center gap-2 min-h-[140px]">
  <div className="w-8 h-8 rounded-lg bg-secondary text-muted-foreground flex items-center justify-center">
    <Plus size={16} />
  </div>
  <p className="text-xs font-semibold text-muted-foreground">New Item</p>
</button>
```

### Dropdown / Context Menu

```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.92, y: -4 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.92, y: -4 }}
  transition={{ duration: 0.12 }}
  className="absolute right-0 top-8 z-30 w-40 bg-popover border border-border rounded-xl shadow-xl overflow-hidden"
>
```

---

## 6. Animation & Motion

All motion uses **Framer Motion** (`framer-motion`).

### Page / Section Entrance

```tsx
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -8 }}
  transition={{ duration: 0.3 }}
>
```

### Card Hover Lift

```tsx
<motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
```

### List Item Entrance

```tsx
<motion.div
  layout
  initial={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.95 }}
>
```

### Collapsible / Accordion

```tsx
<motion.div
  initial={{ opacity: 0, height: 0 }}
  animate={{ opacity: 1, height: "auto" }}
  exit={{ opacity: 0, height: 0 }}
  className="overflow-hidden"
>
```

### Micro Dropdown

```tsx
initial={{ opacity: 0, scale: 0.92, y: -4 }}
animate={{ opacity: 1, scale: 1, y: 0 }}
exit={{ opacity: 0, scale: 0.92, y: -4 }}
transition={{ duration: 0.12 }}
```

### `AnimatePresence` Usage

Always wrap conditional renders and list items in `<AnimatePresence>`. Use `mode="wait"` when swapping between two views (e.g. course content switching).

---

## 7. Layout Architecture

### App Shell

```
┌──────────────────────────────────────────────────────────────┐
│  header.h-14 (AppHeader) — logo · nav · crumbs · ctx/ns · AI │
├──────────────────────────────────────────────────────────────┤
│  main.flex-1.overflow-y-auto                                 │
│  - Radial gradient bg overlay                                │
│  - Page content (p-7)                                        │
│  - TerminalPanel (bottom) · KubectlPalette (⌘K)              │
└──────────────────────────────────────────────────────────────┘
```

Top-header shell (preferred for Electron traffic lights). Keep visual tokens from this guide; do not use the left sidebar layout unless explicitly requested.

```tsx
<div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
  <header className="app-header h-14 border-b border-border/50 bg-card/50 backdrop-blur">
    {/* logo, nav, breadcrumbs, context/namespace, actions */}
  </header>
  <main className="flex-1 overflow-y-auto relative">
    <div className="main-gradient" />
    {children}
  </main>
</div>
```

**Main area:** `flex-1 overflow-y-auto` — scrolling happens here, not the whole window.  
**Electron:** header uses `.app-header` drag region with `pl-20` for macOS traffic lights.

---

## 8. Icon Usage

**Icon library:** `lucide-react`

| Context | Size |
|---|---|
| Nav icons | `size={16}` |
| Card title icons | `size={14}` or `size={15}` |
| Inline text icons | `size={13}` |
| Section / badge icons | `size={9}` to `size={12}` |
| CTA / action icons | `size={13}` to `size={18}` |
| Feature icons in icon containers | `size={18}` |

**Icon containers:**

```tsx
{/* Small icon badge */}
<div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
  <Icon size={15} />
</div>

{/* Medium icon badge */}
<div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
  <Icon size={18} />
</div>
```

---

## 9. Theme / Dark Mode

**Default theme:** `dark`  
**Storage key:** `kubedeck-theme`  
**Provider:** `next-themes` via a `<ThemeProvider>` wrapper

```tsx
<ThemeProvider defaultTheme="dark" storageKey="kubedeck-theme">
```

Toggle pattern:

```tsx
const { theme, setTheme } = useTheme();
// ...
<button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
  {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
</button>
```

---

## 10. Tech Stack Reference

| Layer | Library / Tool | Version |
|---|---|---|
| Framework | React 18 | — |
| Build | Vite | catalog |
| Styling | Tailwind CSS v4 | catalog |
| Component library | shadcn/ui (Radix UI primitives) | — |
| Animation | framer-motion | catalog |
| Icons | lucide-react | catalog |
| Routing | wouter | ^3.3.5 |
| Data fetching | @tanstack/react-query | catalog |
| Forms | react-hook-form + @hookform/resolvers | ^7.55, ^3.10 |
| Charts | recharts | ^2.15 |
| Fonts | Google Fonts: Outfit + JetBrains Mono | — |
| Theme | next-themes | ^0.4.6 |

---

## 11. Key Tailwind Conventions

```css
/* All color tokens via CSS vars */
bg-background   text-foreground    border-border
bg-card         text-card-foreground
bg-primary      text-primary-foreground
bg-secondary    text-secondary-foreground
bg-muted        text-muted-foreground
bg-accent       text-accent-foreground
bg-destructive  text-destructive-foreground
bg-sidebar      text-sidebar-foreground   border-sidebar-border

/* Opacity variants (preferred over arbitrary colors) */
bg-primary/10   bg-primary/20   border-primary/20   text-primary
bg-destructive/5  bg-destructive/10  border-destructive/20
bg-card/50   bg-card/20   (backdrop-blur where glassmorphism is needed)

/* Spacing */
gap-1.5  gap-2  gap-2.5  gap-3  gap-5  gap-6  gap-7
p-3  p-4  p-5  p-7  px-3  py-2  py-2.5

/* Shadows */
shadow-sm   shadow-xl  (on dropdowns)
```

---

## 12. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use semantic color tokens (`text-primary`, `bg-card`) | Hardcode hex/rgb values in classes |
| Use `transition-colors` on all interactive elements | Add transitions without `transition-colors` — it's too broad |
| Use `framer-motion` for enter/exit animations | Use CSS `opacity-0`/`opacity-100` toggling for complex transitions |
| Keep icon sizes small and consistent per context | Mix icon sizes arbitrarily on the same row |
| Use `backdrop-blur` on cards only where depth is needed | Overuse blur — it degrades dark mode readability |
| Wrap conditional list renders in `<AnimatePresence>` | Forget to add `key` props on animated list items |
| Use `text-muted-foreground` for secondary info | Use pure `text-gray-*` or hardcoded opacity classes |
| Use `rounded-2xl` on hero/course cards | Mix radius scales inconsistently across similar card types |
| Keep sidebar styles scoped to `sidebar-*` tokens | Use generic `bg-background` inside the sidebar |
| No emojis anywhere in the UI | Use emojis as icons or status indicators |
