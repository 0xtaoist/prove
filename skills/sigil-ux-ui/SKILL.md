---
name: sigil-ux-ui
description: Complete UX/UI reference for the Sigil frontend — information architecture, design tokens, layout patterns, component library, page templates, navigation system, interaction model, and anti-patterns. Use this when creating or modifying any frontend page or component.
---

# Sigil UX/UI System — Complete Reference

This skill documents the **entire UX/UI system** of the Sigil frontend, distilled from every page, component, layout, and style file. All new work must follow these patterns.

---

## 1. Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js** (App Router, `web/` directory) |
| Styling | **TailwindCSS v4** with `@theme inline` + CSS custom properties |
| Component Library | **shadcn/ui** (radix primitives) + custom components |
| Font | **Figtree** (400–700) via `next/font/google`, variable `--font-figtree` |
| Icons | **lucide-react** exclusively |
| Auth | **Privy** (email, wallet, social OAuth) |
| Toasts | **sonner** (`<Toaster position="bottom-right" />`) |
| 3D | Custom `<ModelViewer>` (GLTF/GLB models) |
| Animations | CSS transitions + `PixelCard` canvas pixel animation |

---

## 2. Design Tokens

### Brand Colors (CSS Custom Properties)

```css
/* Sigil brand */
--purple: 270 42% 33%;        /* #482863 — primary */
--purple-light: 270 40% 43%;  /* #5e3680 */
--purple-dark: 270 44% 23%;   /* #351d4a */

/* Pastel accents — used at /20, /30, /50 opacity */
--sage: 110 33% 93%;          /* #EAF4E8 — pale green */
--lavender: 280 33% 93%;      /* #F2E8F4 — pale purple */
--cream: 50 33% 93%;          /* #F4F3E8 — warm neutral */
--rose: 10 33% 93%;           /* #F4EAE8 — warm pink */
```

### Semantic Tokens (shadcn)

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | purple `270 42% 33%` | Buttons, labels, accents, ring |
| `secondary` | sage `110 33% 93%` | Section header tints, subtle buttons |
| `muted` | cream `50 33% 93%` | Muted backgrounds |
| `accent` | lavender `280 33% 93%` | Accent tints |
| `background` | `0 0% 100%` (white) | Page background |
| `foreground` | `240 10% 12%` (near-black) | Text |
| `muted-foreground` | `240 5% 45%` | Secondary text |
| `border` | `240 6% 90%` | All borders |
| `destructive` | `0 84% 60%` | Error states |

### Structural Colors

| Token | Usage |
|-------|-------|
| `obsidian` | `0 0% 98%` — subtle backgrounds |
| `jet` | `240 10% 96%` — very light tint |
| `ebony` | `280 14% 92%` — lavender-adjacent |
| `dark-gray` | `0 0% 88%` — footer borders |

### Rule: Light-Only Palette
There is **no dark mode**. The theme provider forces `forcedTheme="light"`. Never add dark mode variants.

---

## 3. Layout Spine

Every page shares the same structural shell:

```
┌─────────────────────────────────────────────┐
│ <header> Navbar (h-20, border-b)            │
├─────────────────────────────────────────────┤
│ <main>                                      │
│  ┌─────────────────────────────────────┐    │
│  │ <section> (bg-{pastel}, px-2.5)     │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │ container (border-l border-r) │  │    │
│  │  │  ┌─────────────────────────┐  │  │    │
│  │  │  │ Band 1 (border-b)       │  │  │    │
│  │  │  ├─────────────────────────┤  │  │    │
│  │  │  │ Band 2 (border-b)       │  │  │    │
│  │  │  ├─────────────────────────┤  │  │    │
│  │  │  │ Band N                  │  │  │    │
│  │  │  └─────────────────────────┘  │  │    │
│  │  └───────────────────────────────┘  │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│ <footer> Footer (bg-secondary/30)           │
└─────────────────────────────────────────────┘
```

### App Shell (`app-shell.tsx`)
The `<AppShell>` wraps everything and manages:
1. **3D Model Loader** — full-screen overlay on initial load with `<PixelCard variant="lavender">` atmosphere and animated `<ModelViewer>`
2. **Handoff Animation** — on homepage, the loader model slides from center to the hero stage position
3. **Content Reveal** — `opacity-0 → opacity-100` transition after loader dismisses
4. **Provider Hierarchy**: `ThemeProvider` → `PrivyAuthProvider` → `SessionProvider` → `AppShell` (Navbar + Main + Footer + Toaster)

### Container
```css
@utility container {
    margin-inline: auto;
    padding-inline: 1.5rem;
    max-width: 100%;
    @media (min-width: 1200px) { max-width: 1200px; }
}
```

### Section Wrapper Pattern
```tsx
<section className="min-h-screen bg-background relative overflow-hidden px-2.5 lg:px-0">
  <div className="border-border relative container border-l border-r min-h-screen px-0">
    {/* Content bands stacked here */}
  </div>
</section>
```

Key rules:
- **`px-2.5 lg:px-0`** on the outer section (gutter on mobile)
- **`border-l border-r`** on the container (the vertical spine)
- **`px-0`** on the container (padding comes from individual bands)
- Optionally set `bg-cream` or `bg-background` on the container for page-level tint

---

## 4. Page Band System

Content is organized as **horizontal bands** stacked vertically. Each band is separated by `border-b`. There are distinct band types:

### 4a. Section Label Band
Thin colored strip that labels a section:
```tsx
<div className="px-6 py-3 lg:px-12 border-border border-b bg-cream/30">
  <span className="text-xs text-muted-foreground uppercase tracking-wider">
    Section Label
  </span>
</div>
```
Alternate tints: `bg-cream/30`, `bg-sage/20`, `bg-lavender/20`

### 4b. Section Header Band
Introduces a content section with icon and kicker/heading:
```tsx
<div className="px-6 py-5 lg:px-12 border-border border-b bg-sage/20">
  <div className="flex items-center gap-3">
    <div className="size-10 bg-sage/40 border border-border flex items-center justify-center">
      <Icon className="size-5 text-muted-foreground" />
    </div>
    <div>
      <p className="text-primary text-sm font-medium uppercase tracking-wider">
        kicker text
      </p>
      <h2 className="text-lg font-semibold text-foreground lowercase">
        section heading.
      </h2>
    </div>
  </div>
</div>
```

### 4c. Hero Band
Large introductory band, often with `<PixelCard>` atmosphere:
```tsx
<PixelCard variant="lavender" active centerFade noFocus
  className="border-border border-b bg-lavender/30">
  <div className="px-6 py-14 lg:px-12 lg:py-20">
    <div className="max-w-3xl">
      <p className="text-primary text-sm font-medium uppercase tracking-wider mb-4">
        kicker
      </p>
      <h1 className="text-3xl lg:text-5xl font-semibold text-foreground mb-6 lowercase leading-tight">
        page title.
      </h1>
      <p className="text-muted-foreground text-lg">
        Description text.
      </p>
    </div>
  </div>
</PixelCard>
```

### 4d. Content Grid Band
Grid of items separated by borders (never gaps):
```tsx
<div className="flex flex-col lg:flex-row">
  {items.map((item) => (
    <div className={cn(
      "flex-1 px-6 py-8 lg:px-8",
      "border-border border-b lg:border-b-0 lg:border-r lg:last:border-r-0",
    )}>
      {/* content */}
    </div>
  ))}
</div>
```

### 4e. Split Band (Text + Visual)
50/50 layout with content and media:
```tsx
<div className="flex flex-col lg:flex-row">
  <div className="lg:w-1/2 border-border border-b lg:border-b-0 lg:border-r">
    {/* Text content */}
  </div>
  <div className="lg:w-1/2">
    {/* Visual content (video, image, code) */}
  </div>
</div>
```

### 4f. CTA Band
Purple-background call-to-action (always last on page):
```tsx
<div className="bg-primary">
  <div className="px-6 py-3 lg:px-12 border-b border-primary-foreground/20">
    <span className="text-xs text-primary-foreground/70 uppercase tracking-wider">
      Get Started
    </span>
  </div>
  <div className="flex flex-col lg:flex-row">
    <PixelCard variant="primary" className="flex-1 border-primary-foreground/20 lg:border-r" noFocus>
      <div className="px-6 py-10 lg:px-12 lg:py-12">
        <h2 className="text-primary-foreground text-2xl lg:text-3xl font-semibold mb-4 lowercase">
          cta heading.
        </h2>
        <p className="text-primary-foreground/80 mb-8 max-w-md">Description.</p>
        <Button size="lg" variant="secondary"
          className="bg-background text-foreground hover:bg-background/90 gap-2">
          Action <ArrowRight className="size-4" />
        </Button>
      </div>
    </PixelCard>
    {/* Second CTA card (optional) */}
  </div>
</div>
```

### 4g. Alternating Background Rhythm
Cycle through pastels for visual rhythm:
```
Band 1: bg-background    (white)
Band 2: bg-sage/20       (pale green)
Band 3: bg-background    (white)
Band 4: bg-lavender/20   (pale purple)
Band 5: bg-cream/30      (warm)
```

---

## 5. Navigation System

### 5a. Navbar (`navbar.tsx`)

- **Height**: `h-20` with `border-b`
- **Structure**: `container` with `border-x` → logo left, nav center, auth right
- **Nav items**: Wrapped in `<NavigationMenu>` with `divide-x divide-border border border-border`
- **Active state**: `bg-sage/20 text-primary`
- **Primary link**: `bg-lavender/20` when not active (e.g., "Verify")
- **Hover**: `hover:bg-sage/15`

#### Desktop Mega Dropdown
Two-column panel (`w-[min(92vw,780px)]`):
- **Left sidebar** (220px): Kicker label, headline (lowercase), description, item count
- **Right grid** (2 columns): Items with icon boxes (`size-9 border border-border`), title, description, hover "Open ↗" reveal

Dropdown accent tints:
| Group | Accent |
|-------|--------|
| Build | `bg-sage/20` |
| Resources | `bg-lavender/25` |

#### Mobile Menu
Full-screen overlay (`h-[calc(100vh-80px)]`) with:
- `divide-y divide-border` nav items
- Accordion-style dropdown expansion
- `bg-sage/10` footer spacer

### Top-Level Routes

| Route | Label | Position |
|-------|-------|----------|
| `/verify` | Verify | Primary (standalone) |
| `/dashboard` | Dashboard | Standalone |
| `/chat` | Chat | Standalone |
| `/launches` | Launches | Build dropdown |
| `/agents` | Agents | Build dropdown |
| `/connect` | Connect | Build dropdown |
| `/governance` | Governance | Build dropdown |
| `/developers` | Developers | Build dropdown |
| `/integrations` | Integrations | Build dropdown |
| `/status` | Status | Build dropdown |
| `/features` | Features | Resources dropdown |
| `/faq` | FAQ | Resources dropdown |
| `/blog` | Blog | Resources dropdown |
| `/changelog` | Changelog | Resources dropdown |
| `/about` | About | Resources dropdown |
| `/leaderboard` | Leaderboard | Resources dropdown |
| `/stats` | Stats | Resources dropdown |

### 5b. Footer (`footer.tsx`)

Three-column grid on `bg-secondary/30` with `border-dark-gray`:
1. **Protocol** links
2. **Resources** links
3. **Connect** (social icons)

Below: description band + logo, then legal bar (`Privacy`, `Terms`, `Audit`).

---

## 6. Component Library

### 6a. Button (`button.tsx`)
Built with `cva`. **No `rounded-*`** — all buttons are square.

| Variant | Appearance |
|---------|-----------|
| `default` | `bg-primary text-primary-foreground border-primary` — main CTAs |
| `outline` | `border-border bg-transparent` → `hover:bg-secondary/50` |
| `secondary` | `bg-sage text-foreground border-sage` |
| `ghost` | No border, `hover:bg-secondary/50` |
| `link` | `text-primary underline-offset-4 hover:underline` |
| `soft` | `bg-lavender text-foreground border-lavender` |
| `muted` | `bg-cream text-foreground border-cream` |
| `destructive` | `bg-destructive text-destructive-foreground` |
| `toggle` | Transparent → `hover:bg-lavender/50 text-primary` |

| Size | Dimensions |
|------|-----------|
| `sm` | `h-8 px-3 text-xs` |
| `default` | `h-10 px-5` |
| `lg` | `h-12 px-8 text-base` |
| `xl` | `h-14 px-10 text-base font-semibold` |
| `icon` | `size-10` |
| `icon-sm` | `size-8` |

### 6b. Badge (`badge.tsx`)
Square badges (no rounding). Custom Sigil variants:

| Variant | Style |
|---------|-------|
| `sage` | `bg-sage text-foreground` |
| `lavender` | `bg-lavender text-foreground` |
| `cream` | `bg-cream text-foreground` |
| `rose` | `bg-rose text-foreground` |
| `outline` | `text-foreground` with border |

### 6c. PixelCard (`pixel-card.tsx`)
Canvas-based animated pixel background. Used for hero bands and CTA sections.

| Variant | Colors | Usage |
|---------|--------|-------|
| `default` | Grays | Subtle backgrounds |
| `sage` | Sage tones | Green-tinted sections |
| `lavender` | Lavender tones | Purple-tinted heroes |
| `cream` | Cream tones | Warm sections |
| `primary` | Green `#3DDC84` | CTA sections on purple bg |

Props: `variant`, `active` (auto-animate), `centerFade` (radial fade), `noFocus` (disable hover trigger)

Usage pattern:
```tsx
<PixelCard variant="lavender" active centerFade noFocus
  className="border-border border-b bg-lavender/30">
  {children}
</PixelCard>
```

### 6d. Icon Containers
Square containers (never rounded):
```tsx
{/* Standard */}
<div className="size-10 bg-sage/40 border border-border flex items-center justify-center">
  <Icon className="size-5 text-muted-foreground" />
</div>

{/* On purple bg */}
<div className="size-10 bg-background/20 flex items-center justify-center">
  <Icon className="size-5 text-primary-foreground" />
</div>
```

### 6e. Code / Terminal Blocks
```tsx
<div className="border border-border bg-foreground/[0.03]">
  <div className="border-border border-b px-4 py-2 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="size-2 bg-green-500 animate-pulse" />
      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        terminal
      </p>
    </div>
    <Button variant="ghost" size="sm" className="h-7 text-xs">
      <Copy className="mr-1.5 size-3" /> Copy
    </Button>
  </div>
  <pre className="px-4 py-4 text-sm font-mono text-foreground overflow-x-auto">
    {code}
  </pre>
</div>
```

### 6f. Status Dots
```tsx
<div className="size-2 bg-green-500 animate-pulse" />  {/* Online */}
<div className="size-1.5 bg-primary" />                  {/* Bullet */}
<div className="size-2 bg-muted-foreground" />           {/* Offline */}
```

### 6g. Stepper / Numbered Items
```tsx
<div className="px-4 py-3 flex items-start gap-3">
  <div className="size-6 bg-lavender/30 border border-border flex items-center justify-center shrink-0 text-xs font-mono text-primary">
    1
  </div>
  <div>
    <p className="text-sm font-medium text-foreground">Title</p>
    <p className="text-xs text-muted-foreground">Description</p>
  </div>
</div>
```

### 6h. UI Spacing Tokens
```
px-6 py-4 lg:px-12       → Standard band padding
px-6 py-8 lg:px-8        → Content cell padding
px-6 py-12 lg:px-12 lg:py-20  → Hero padding
px-4 py-3                → Compact list item
px-2.5 py-1              → Tiny badges/tags
```

---

## 7. Page Template Patterns

### 7a. Standard Content Page (e.g., About, Features)
```
Section wrapper (bg-background)
  └─ Container spine (border-l border-r)
     ├─ Hero Band (PixelCard lavender, h1 lowercase, kicker uppercase)
     ├─ Split Band (⅓ left label + ⅔ right content)
     ├─ Grid Band (3-col with border separators)
     ├─ Grid Band (alternating bg)
     ├─ Split Band
     └─ CTA Band (bg-primary, PixelCard primary, 2-col)
```

### 7b. Dashboard / Interactive Page (e.g., Chat, Governance)
```
Section wrapper (min-h-screen flex flex-col)
  └─ Container spine (flex flex-col)
     ├─ PixelCard header (kicker + title + status badge)
     ├─ Tab bar (grid grid-cols-N, border-b, divide-x)
     ├─ Content area (flex-1 overflow-hidden)
     │   ├─ Sidebar (border-r, hidden on mobile)
     │   └─ Main panel (flex-1)
     └─ Input area (border-t, prompt/form)
```

### 7c. Chat Page Special Layout
- Hides footer via `document.getElementById("site-footer").style.display = "none"`
- Full-viewport height (`min-h-screen flex flex-col`)
- `<PixelCard>` header with conversation metadata
- Two-column layout: Main chat thread + `<PortfolioSidebar>` (right)
- Sidebar tabs: "chat" (user thread) | "agents" (live agent feed)
- Tab styling: `grid grid-cols-2 border-b`, active = `bg-lavender/35`, inactive = `hover:bg-sage/15`

### 7d. Multi-Step Flow Page (e.g., Verify)
- `<VerifyFlow>` component with internal step state
- Steps directory: `steps/ChannelSelect.tsx`, `steps/GitHubVerify.tsx`, etc.
- Each step is a band with its own header and content
- Progress tracked via hook (`useVerificationService`)

---

## 8. Typography Rules

| Element | Classes | Casing |
|---------|---------|--------|
| Kicker label | `text-primary text-sm font-medium uppercase tracking-wider` | UPPERCASE |
| Tiny kicker | `text-xs text-muted-foreground uppercase tracking-wider` | UPPERCASE |
| Micro label | `text-[11px] font-medium tracking-[0.16em] uppercase text-muted-foreground` | UPPERCASE |
| Page title (h1) | `text-3xl lg:text-4xl font-semibold text-foreground lowercase` | lowercase |
| Large hero h1 | `text-3xl lg:text-5xl font-semibold text-foreground lowercase leading-tight` | lowercase |
| Section heading (h2) | `text-lg font-semibold text-foreground lowercase` | lowercase |
| Large h2 | `text-2xl lg:text-3xl font-semibold lowercase` | lowercase |
| Sub-heading (h3) | `text-lg font-semibold text-foreground` | Normal |
| Item title | `text-sm font-medium text-foreground` | Normal |
| Body text | `text-muted-foreground text-sm` | Normal |
| Detail text | `text-xs text-muted-foreground` | Normal |
| Mono labels | `text-xs font-mono uppercase tracking-wider text-primary` | UPPERCASE |
| Code/Terminal | `font-mono text-foreground` | Normal |
| Font family | Figtree via `--font-figtree` | — |

---

## 9. Interaction Patterns

### 9a. Hover States
```
Buttons:       hover:bg-primary/90 (darken)
Nav items:     hover:bg-sage/15 (sage tint)
Dropdown items: hover:bg-sage/15 + reveal "Open ↗" label
Cards:         PixelCard onMouseEnter triggers pixel appear animation
Links:         hover:text-primary transition-colors
Copy buttons:  "Copy" → "Copied" (1.2s timeout)
```

### 9b. Active/Current States
```
Nav:           bg-sage/20 text-primary
Tab:           bg-lavender/35 text-foreground
Phase/Step:    bg-lavender/10 + "Current" badge
Badge:         bg-lavender/50 border border-border
```

### 9c. Loading / Status
- **3D Model Loader**: Full-screen `<PixelCard variant="lavender">` atmosphere with centered `<ModelViewer>`, minimum 2s display, cubic-bezier handoff slide
- **Thinking Indicator**: `<ThinkingMessage>` with min 2s display
- **Status Badge**: `inline-flex items-center gap-2 border border-border bg-background/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]`
- **Pulsing Dot**: `size-2 bg-green-500 animate-pulse`
- **Spinner**: `<Loader2 className="animate-spin" />`

### 9d. AI Chat Elements
Located in `components/ai-elements/`:
- `<Conversation>` + `<ConversationContent>` — scrollable message container
- `<Message>` + `<MessageContent>` — user/assistant message bubbles
- `<Response>` — markdown-rendered AI response
- `<PromptInput>` — textarea with toolbar, status, and submit
- `<ChainOfThought>` — collapsible reasoning steps
- `<Tool>` + `<ToolHeader>` + `<ToolContent>` — tool invocation cards
- `<Sources>` + `<Source>` — citation links
- `<Reasoning>` + `<ReasoningContent>` — thinking display
- `<ThinkingMessage>` — loading animation
- `<Suggestion>` — quick-action pill buttons

### 9e. Tool Views
Located in `components/tool-views/`:
- `<WebSearchView>` — search results display
- `<NewsSearchView>` — news article cards
- `<AnalyzeView>` — problem analysis panel
- `<DecideView>` — option comparison
- `<ProvideAnswerView>` — final synthesized answer

---

## 10. Special Components

### 10a. ModelViewer
3D GLTF/GLB model renderer at `components/ModelViewer.tsx` (23KB).
Props: `width`, `height`, `autoRotate`, `enableMouseParallax`, `enableHoverRotation`, `enableManualRotation`, `enableManualZoom`, `fadeIn`, `showLoader`, `showScreenshotButton`, `onModelLoaded`.

### 10b. PortfolioSidebar
Right-side panel on chat page at `components/PortfolioSidebar.tsx` (29KB). Shows wallet balances, token holdings, transaction history. Full-height panel with internal scrolling.

### 10c. GovernanceDashboard
Multi-component governance interface in `components/GovernanceDashboard/`:
- `index.tsx` — main dashboard layout
- `components/` — 8 sub-components (proposal cards, voting UI, etc.)
- `hooks/` — governance data fetching
- Reads from on-chain `SigilEscrow` contract

### 10d. VerifyFlow
Multi-step verification wizard in `components/VerifyFlow/`:
- `index.tsx` — step router
- `steps/` — 5 step components (channel select, GitHub, X, Facebook, Domain verification)
- `constants.ts` — channel definitions
- `types.ts` — verification types
- `hooks/` — verification service hook

---

## 11. Information Architecture

### Page Categories

| Category | Pages | Description |
|----------|-------|-------------|
| **Core Product** | `/verify`, `/dashboard`, `/chat` | Primary user flows |
| **Build** | `/launches`, `/agents`, `/connect`, `/governance`, `/developers`, `/integrations`, `/status` | Builder and protocol tools |
| **Resources** | `/features`, `/faq`, `/blog`, `/changelog`, `/about`, `/leaderboard`, `/stats` | Information pages |
| **Auth** | `/login`, `/signup` | Authentication |
| **Legal** | `/privacy`, `/terms`, `/cookie-policy` | Legal documents |
| **Special** | `/migrate`, `/audit` | Utility pages |

### Homepage Section Flow
1. `SigilHero` — 3D model + headline + quick launch + stats
2. `SigilLogos` — partner/tech logos marquee
3. `SigilTriptych` — 3-column Verify/Fund/Govern cards
4. `SigilContext` — Problem/solution narrative
5. `SigilProtocol` — Protocol mechanics
6. `SigilAudience` — Target users
7. `SigilTrustLayer` — Trust explanation
8. `SigilInfrastructure` — Video demo + features
9. `SigilProof` — Evidence/metrics
10. `SigilCTA` — Purple CTA with two PixelCards

---

## 12. Animation & Keyframes

```css
/* Accordion expand/collapse (shadcn) */
@keyframes accordion-down { from { height: 0 } to { height: var(--radix-accordion-content-height) } }
@keyframes accordion-up { from { height: var(--radix-accordion-content-height) } to { height: 0 } }

/* Logo/brand marquee */
@keyframes marquee { 0% { transform: translateX(0%) } 100% { transform: translateX(-100%) } }
```

### Transition Defaults
- Content reveal: `transition-opacity duration-500`
- Hover states: `transition-colors` (default 150ms)
- Mobile menu: `transition duration-300 ease-in-out`
- Model handoff: `ease-[cubic-bezier(0.22,1,0.36,1)]`

---

## 13. Anti-Patterns (Do NOT)

- ❌ **No `rounded-*`** on containers, sections, buttons, badges, or icon boxes (squares only)
- ❌ **No `shadow-*`** for elevation — structure comes from borders
- ❌ **No dark mode** — light-only palette, `forcedTheme="light"`
- ❌ **No gap-based grid separators** — always use `border-*` or `divide-*`
- ❌ **No floating cards** — everything is inline in the border spine
- ❌ **No Title Case headings** — h1/h2 always use `lowercase` class
- ❌ **No saturated background colors** — only pastel tints at `/20`, `/30`, or `/50`
- ❌ **No icons outside lucide-react** — no heroicons, no font-awesome
- ❌ **No custom fonts** — only Figtree via the CSS variable
- ❌ **No inline styles** for layout — use Tailwind classes exclusively
- ❌ **No `gap-*` between grid cells** — use `border-r`/`border-b` between siblings
- ❌ **No absolute positioning for layout** — use flex/grid with border separators
- ❌ **No `max-w-screen-*` containers** — use the custom `container` utility (1200px max)

---

## 14. File Structure Reference

```
web/src/
├── app/
│   ├── globals.css          ← Design tokens + custom properties
│   ├── layout.tsx           ← Root layout (Figtree font, metadata, providers)
│   ├── LayoutInner.tsx      ← Legacy inner layout wrapper
│   ├── page.tsx             ← Homepage (10 section components)
│   ├── not-found.tsx        ← 404 page
│   └── {page}/page.tsx      ← 26 route pages
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx    ← AppShell (navbar + footer + 3D loader)
│   │   ├── navbar.tsx       ← Mega-dropdown navigation
│   │   └── footer.tsx       ← 3-column footer
│   ├── ui/                  ← 16 shadcn primitives + custom components
│   │   ├── button.tsx       ← 9 variants, 7 sizes
│   │   ├── badge.tsx        ← 8 variants (incl. sage/lavender/cream/rose)
│   │   ├── pixel-card.tsx   ← Canvas pixel animation component
│   │   ├── accordion.tsx    ← Collapsible sections
│   │   ├── carousel.tsx     ← Image/content carousel
│   │   └── ...              ← input, label, checkbox, switch, tabs, etc.
│   ├── sections/            ← 33 section components (homepage + reusables)
│   ├── ai-elements/         ← 14 chat UI components
│   ├── tool-views/          ← 6 tool visualization components
│   ├── common/              ← EmptyState, ErrorAlert, LoadingButton, etc.
│   ├── GovernanceDashboard/ ← Governance feature module
│   ├── VerifyFlow/          ← Verification wizard module
│   ├── ConnectFlow/         ← Connect/handshake feature
│   ├── Launches/            ← Token launch browser
│   ├── FeeVault/            ← Fee claim interface
│   ├── ProfileDashboard/    ← User dashboard
│   ├── PortfolioSidebar.tsx ← Wallet/portfolio panel
│   ├── ModelViewer.tsx      ← 3D model renderer
│   └── ErrorBoundary.tsx    ← React error boundary
├── hooks/                   ← 13 custom hooks
├── lib/                     ← Utilities, API client, contracts, formatters
├── config/                  ← contracts.ts, token-colors.ts, verification-methods.ts
├── contexts/                ← SessionContext
├── providers/               ← PrivyAuthProvider
└── types/                   ← Type definitions (token, governance, chat, wallet, etc.)
```
