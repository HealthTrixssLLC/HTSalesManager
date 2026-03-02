# Change Request CR002 — Brand Identity Alignment
**Status**: Pending Approval  
**Created**: 2026-03-02  
**Reference**: https://healthtrixss-style-guide.replit.app/  
**Logo Asset**: `attached_assets/HT_Logo_Small_+_Orange_1772475026136.png`

---

## Summary

The current CRM uses Health Trixss Teal (`hsl(186, 78%, 32%)`) as the dominant brand color throughout — sidebar, primary buttons, icons, ring, and dashboard accents. The official HealthTrixss Design System (style guide) specifies a different palette centered on **Dark Blue** as primary, **Orange** as the accent/CTA color, and **Teal demoted to a secondary info role**. Additionally, the logo is the official "H+" mark (gray H, orange +), not the current hand-built "HT" text badge.

This CR aligns the CRM to the official brand identity.

---

## Logo

### Current
A hand-built text badge: white "HT" text on a teal rounded square, created in JSX.

### Official Logo (from asset)
The `H+` mark: a dark-gray bordered square containing:
- **"H"** in charcoal/dark gray
- **"+"** in orange (`#FEA002`)

### Changes Required
- Replace the hand-built "HT" badge in the sidebar header with the actual logo image (`@assets/HT_Logo_Small_+_Orange_1772475026136.png`)
- Replace the "HT" badge on the login page left panel with the same image
- Adjust sizing to ~32–40px height, preserving aspect ratio

---

## Brand Name / Wordmark

### Current
"Health Trixss" (two words, title case) — used in sidebar header and login page.

### Style Guide
"HEALTHTRIXSS" or "HealthTrixss" — the style guide header uses "HealthTrixss" as a single word. The brand tagline is "Healthcare Innovation & Analytics".

### Changes Required
- Update sidebar wordmark from "Health Trixss" to "HealthTrixss"
- Update login page left panel wordmark to match
- Update page `<title>` in `index.html` to "HealthTrixss CRM"

---

## Color System

### Current Palette (post-CR001)

| Token | Current Value | Role |
|-------|---------------|------|
| `--primary` | `hsl(186, 78%, 32%)` — Teal | Buttons, active states, primary actions |
| `--secondary` | `hsl(38, 100%, 50%)` — Amber | Secondary actions |
| `--sidebar` | `hsl(186, 62%, 16%)` — Dark teal | Sidebar background |
| `--background` | `hsl(0, 0%, 99%)` — Near white | App background |
| `--card` | `hsl(0, 0%, 100%)` — White | Card surface |
| `--ring` | `hsl(186, 78%, 32%)` — Teal | Focus ring |
| `--input` | `hsl(186, 18%, 94%)` — Teal-tinted | Input background |
| `--muted-foreground` | `hsl(215, 14%, 42%)` | Secondary text |

### Official Palette (from style guide)

| Token | Official Value | Role |
|-------|----------------|------|
| **Dark Blue** | `#2E456B` / `hsl(216, 40%, 30%)` | Primary, sidebar, headers, text primary |
| **Orange** | `#FEA002` / `hsl(39, 99%, 50%)` | Primary accent, CTAs, interactive highlights |
| **Dark Teal** | `#277493` / `hsl(195, 57%, 37%)` | Secondary accent, info states |
| **Tan** | `#F3DBB1` / `hsl(38, 70%, 82%)` | Warm secondary surfaces |
| **Light Orange** | `#FFCA4B` / `hsl(43, 100%, 65%)` | Warning states |
| **Light Green** | `#88ABA2` / `hsl(163, 18%, 60%)` | Success indicators |
| **Light Teal** | `#67AABF` / `hsl(195, 40%, 58%)` | Info highlights, links |
| **Light Grey** | `#ABAFA5` / `hsl(72, 6%, 67%)` | Muted text, disabled |
| **Background Light** | `#FAF7F2` / `hsl(38, 27%, 97%)` | Main app background (warm cream) |
| **Card Background** | `#FFFFFF` | Card and panel surfaces |
| **Sidebar Dark** | `#2E456B` | Sidebar background |
| **Destructive** | `#D94E41` / `hsl(4, 59%, 55%)` | Error/destructive actions |
| **Text Muted** | `#6B7280` / `hsl(220, 9%, 46%)` | Secondary text |

### Proposed CSS Variable Mapping

```
:root (light mode)
--primary:            216 40% 30%     (Dark Blue #2E456B)
--primary-foreground: 0 0% 100%       (White)
--secondary:          38 70% 82%      (Tan #F3DBB1)
--secondary-foreground: 216 40% 25%  (Dark Blue text on Tan)
--accent:             39 99% 50%      (Orange #FEA002) → moved to accent
--accent-foreground:  0 0% 100%       (White)
--muted:              38 27% 95%      (Warm cream near-background)
--muted-foreground:   220 9% 46%      (#6B7280)
--background:         38 27% 97%      (Warm cream #FAF7F2)
--card:               0 0% 100%       (White)
--border:             216 20% 88%     (Blue-tinted border)
--input:              216 18% 94%     (Blue-tinted input bg)
--ring:               39 99% 50%      (Orange focus ring — draws attention)
--destructive:        4 59% 55%       (#D94E41)
--sidebar:            216 40% 30%     (Dark Blue)
--sidebar-foreground: 0 0% 95%
--sidebar-accent:     216 35% 38%     (slightly lighter dark blue for hover)
--sidebar-primary:    39 99% 50%      (Orange for active sidebar items)
```

---

## Sidebar

### Current
Dark teal gradient (`hsl(186,65%,14%)` → `hsl(186,48%,22%)`), teal accent on active items.

### Target
- Background: Solid or subtle gradient on **Dark Blue** `#2E456B`
- Active item: **Orange** `#FEA002` accent (pill or left-border indicator)
- Inactive items: white/65% opacity (same pattern, different base color)
- Logo: H+ image asset
- Width: 256px (per style guide spec, current is 15rem/240px)

---

## Primary Buttons & CTAs

### Current
Solid teal background (`hsl(186, 78%, 32%)`), white text.

### Target
**Two valid options per style guide:**
1. **Orange CTAs** — `#FEA002` with dark text (or white) — for primary calls to action
2. **Dark Blue CTAs** — `#2E456B` with white text — for primary brand actions

The style guide designates Orange as "primary accent, CTAs, highlights" and Dark Blue as the "primary brand color". A common healthcare SaaS pattern: use Dark Blue for destructive/neutral primary actions and Orange for highlighted CTAs (e.g. "New Account", "Save").

**Proposed**: Dark Blue as the default primary button color, Orange as a distinct accent class for high-emphasis CTAs and highlights (e.g. dashboard "Download Report", empty state CTAs).

---

## Dashboard Stat Card Icons

### Current
Teal icon squares (`hsl(186, 78%, 32%)`).

### Target
**Dark Blue** icon squares (`#2E456B`) or **Orange** for high-emphasis metrics. The style guide KPI card examples use orange accents for positive-trend indicators.

---

## Background

### Current
Near-white `hsl(0, 0%, 99%)`.

### Target
Warm cream `#FAF7F2` / `hsl(38, 27%, 97%)` — the style guide's "Background Light". This gives a warmer, healthcare-appropriate feel distinct from generic SaaS whites.

---

## Typography Scale

### Current (post-CR001)
Page headers use `text-2xl font-semibold`.

### Style Guide Spec
- H1 / Page Title: `text-3xl font-bold`
- H2 / Section Header: `text-2xl font-semibold`
- H3 / Card Header: `text-xl font-semibold`
- Labels: `text-sm font-medium uppercase tracking-wide`
- Font: Inter, IBM Plex Sans (Inter already applied ✓)

**Note**: The style guide specifies `text-3xl font-bold` for page titles (H1) — this is **larger** than the `text-2xl font-semibold` applied in CR001. Decision needed: follow the style guide's scale (reverting CR001 header sizes) or maintain the current tighter scale.

---

## Badge & Status Colors

Most badge colors align well with the style guide. Minor adjustments:

| State | Current | Style Guide | Delta |
|-------|---------|-------------|-------|
| Success | emerald-100/700 | `#88ABA2` (Light Green) | Shift to muted sage green |
| Warning | amber-100/700 | `#FFCA4B` (Light Orange) | Shift to gold/yellow |
| Info | blue-100/700 | `#277493` (Dark Teal) | Shift to teal |
| Pending | amber-100/700 | `#FEA002` (Orange) | Shift to brand orange |
| Critical | red-100/700 | `#D94E41` | Minor hue adjustment |

---

## Files Affected

| File | Change |
|------|--------|
| `client/index.html` | Update `<title>` to "HealthTrixss CRM" |
| `client/src/index.css` | Full CSS variable update — primary, accent, background, sidebar, input, ring, destructive, all badge/semantic tokens |
| `client/src/components/app-sidebar.tsx` | Logo image, sidebar bg color, active item accent color, width 256px, wordmark "HealthTrixss" |
| `client/src/pages/auth-page.tsx` | Logo image, left panel bg to Dark Blue, wordmark |
| `client/src/pages/dashboard.tsx` | Stat card icon bg color (teal → dark blue or orange) |
| `client/src/pages/leads-page.tsx` | Badge colors adjusted to style guide semantic tokens |
| `client/src/pages/activities-page.tsx` | Badge colors adjusted |
| `client/src/pages/opportunities-page.tsx` | Stage badge colors updated |
| `client/public/` | Copy logo image for use in sidebar/auth |
| `replit.md` | Update brand color documentation |

---

## Implementation Tasks

| ID | Task | Scope |
|----|------|-------|
| **BR-001** | CSS variable overhaul | index.css — all color tokens |
| **BR-002** | Logo image integration | Copy asset to public/, update sidebar + login |
| **BR-003** | Sidebar recolor | Dark Blue bg, orange active accent, 256px width |
| **BR-004** | Login page recolor | Dark Blue left panel, wordmark update |
| **BR-005** | Button color update | Primary → Dark Blue, accent CTA → Orange |
| **BR-006** | Dashboard icon squares | Dark Blue or Orange |
| **BR-007** | Background warm cream | `#FAF7F2` across app |
| **BR-008** | Badge color alignment | Match style guide semantic tokens |
| **BR-009** | Wordmark/title updates | index.html, sidebar, login page |

---

## Open Questions for Approval

1. **Primary button color**: Dark Blue or Orange for the default primary `<Button>`? The style guide says Orange is "CTAs" but Dark Blue is "primary". Suggest: **Dark Blue default button, Orange for accent/highlight CTAs**.

2. **Page header size**: Style guide says H1 = `text-3xl font-bold`. CR001 set these to `text-2xl font-semibold`. Should we follow the style guide strictly (revert header sizes) or keep the compact `text-2xl`?

3. **Sidebar width**: 256px per style guide (current is 240px / 15rem). Minor change — confirm if desired.

4. **Teal retention**: The current app has extensive teal usage in charts, certain detail pages, and the existing brand history. Should teal be **fully replaced** or retained in data visualisation and certain accent contexts?
