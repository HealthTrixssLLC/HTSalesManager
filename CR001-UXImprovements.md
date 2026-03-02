# Change Request CR001 — UX Improvements
**Status**: Complete  
**Created**: 2026-03-02  
**Last Updated**: 2026-03-02 (T005–T009 UX Overhaul — All VR Tasks Complete)

---

## 1. Saved Filter Presets

### Summary
Users on all list pages (Opportunities, Accounts, Contacts, Leads, Activities) can save their current filter state as a named preset. One preset per page can be marked as **Default** and will be automatically applied when that page is loaded.

### Requirements

#### FR-001: Save Filter Preset
- [x] Users can save the current filter state on any page that has filters
- [x] Saving opens a dialog asking for a preset name
- [x] A "Set as default" checkbox is available in the save dialog
- [x] Saved presets are **per user** — each user has their own presets

#### FR-002: Default Preset Auto-Apply
- [x] One preset per user per page can be marked as **Default**
- [x] When a page loads and the user has no active filters set, the default preset is automatically applied
- [x] Setting a new default clears the previous default for that page
- [x] The default preset is visually distinguished with a star icon

#### FR-003: Apply Saved Presets
- [x] Saved presets appear as clickable chips/badges in a bar below the page header
- [x] Clicking a preset chip immediately applies all those filter values
- [x] The currently active preset (if any) is highlighted

#### FR-004: Manage Presets
- [x] Users can rename a preset via a context menu on the chip
- [x] Users can change which preset is the default via context menu
- [x] Users can delete a preset via context menu

#### FR-005: Pages Covered
- [x] Opportunities (filterAccount, closeDateFrom, closeDateTo, probabilityMin, probabilityMax, rating, tagIds, includeInForecast)
- [x] Accounts (search, type, category, ownerId, tagIds)
- [x] Contacts (search, accountId, ownerId, hasEmail, tagIds)
- [x] Leads (search, status, rating, ownerId, tagIds)
- [x] Activities (type, status, priority, ownerId, dateFrom, dateTo, tagIds)

### Database
New table: `saved_filters`
- `id`: UUID PK
- `userId`: FK → users
- `pageName`: varchar (e.g. "opportunities")
- `name`: varchar (user-given name)
- `filters`: jsonb (filter state snapshot)
- `isDefault`: boolean (default false)
- `createdAt`, `updatedAt`: timestamps

### API Endpoints
- `GET /api/saved-filters?page=<pageName>` — list user's presets for a page
- `POST /api/saved-filters` — create preset
- `PUT /api/saved-filters/:id` — update name/isDefault
- `DELETE /api/saved-filters/:id` — delete preset

---

## 2. UX Overhaul — Visual Redesign

### Summary
A comprehensive visual refresh of the Health Trixss CRM to align with the HT brand identity, improve usability, and create a visually compelling, modern enterprise SaaS experience. Current design is flat and unpolished; the new design should feel premium, confident, and immediately trustworthy.

### Brand Identity

**Primary Brand Color**: Health Trixss Teal — `hsl(186, 78%, 32%)` / `#128591`  
**Brand Mark**: "HT" initials in a rounded square, white text on teal background  
**Favicon**: HT branded SVG favicon (already implemented)  
**Wordmark**: "Health Trixss" in Inter font, bold weight  

### Design Direction

The redesign should follow a **"Premium Healthcare SaaS"** aesthetic — clean but not cold, data-rich but not cluttered, professional but with character. Think of the intersection between Salesforce Lightning and Linear.

### Visual Requirements

#### VR-001: Sidebar
- [x] Sidebar background: deep teal gradient (`from-[hsl(186,65%,14%)] to-[hsl(186,48%,22%)]`)
- [x] "Health Trixss" wordmark with HT icon badge at top — white on dark teal
- [x] Navigation items: icon + label, white/65% opacity when inactive, white/100% + pill accent when active
- [x] Bottom section: user avatar, name, email — separated by a subtle border with logout button
- [x] Sidebar width: 15rem
- [x] Gradient with multi-stop teal fade

#### VR-002: Top Bar / Header Area
- [x] Minimal top bar — just the sidebar toggle, no redundant header
- [x] Each page header: bold page title (text-2xl, font-semibold), subtitle in muted foreground, action buttons right-aligned
- [x] All pages have consistent `p-6` padding and `space-y-6` vertical rhythm

#### VR-003: Cards
- [x] Cards: white background with very subtle teal-tinted border (`hsl(186,22%,90%)`)
- [x] Border radius: `rounded-md` (via `--radius: 0.5rem`)
- [x] Shadows: real teal-tinted box shadows applied (shadow-sm, shadow-md)
- [x] Stat cards on dashboard: teal icon square accent

#### VR-004: Typography
- [x] Font: Inter (updated from Open Sans)
- [x] Page title: `text-2xl font-semibold text-foreground` (applied to all pages)
- [x] Section headers: `text-lg font-medium` (via global h3 base)
- [x] Table headers: `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- [x] Metric numbers on dashboard: `text-3xl font-bold`

#### VR-005: Color Palette Refinement
- [x] Background: clean white (`hsl(0,0%,99%)`) with subtle teal-warm card surfaces
- [x] Surface (cards): `hsl(0,0%,100%)` — clean white
- [x] Border: `hsl(186,18%,88%)` — soft teal-tinted border
- [x] Primary actions: `hsl(186,78%,32%)` teal buttons — white text
- [x] Destructive: warm red `hsl(356,90%,54%)`
- [x] Input background: `hsl(186,18%,94%)` — light teal tint
- [x] Ring (focus): teal `hsl(186,78%,32%)` — replaces previous amber

#### VR-006: Dashboard Stat Cards
- [x] 4-column grid of stat cards
- [x] Icon in a teal-colored rounded square (top-right of card)
- [x] Large metric number (text-3xl font-bold)
- [x] Uppercase small label with muted foreground
- [x] Subtle trend indicator (new leads this month)

#### VR-007: Tables
- [x] Row hover: `hover-elevate` class applied (subtle elevation on hover)
- [x] Table header styling: uppercase, tracking-wider, muted-foreground (applied globally via VR-004 typography)
- [x] Consistent border via theme `--border` variable

#### VR-008: Buttons
- [x] Primary: solid teal (hsl 186 78% 32%), white text, teal-tinted shadow
- [x] Secondary/Outline: teal border and text via CSS variable
- [x] Ghost: transparent, teal text on hover via sidebar nav items
- [x] Destructive: warm red via `--destructive` variable
- [x] Ring (focus): teal — consistent across all controls

#### VR-009: Badges & Status Indicators
- [x] Pipeline stage badges: subtle semantic colors (slate/blue/amber/orange/emerald/red backgrounds with matching text)
- [x] Lead status: new=blue, contacted=amber, qualified=emerald, unqualified=gray, converted=teal
- [x] Lead rating: Hot=red, Warm=amber, Cold=slate-blue with border coloring
- [x] Activity status: pending=amber, completed=emerald, cancelled=gray
- [x] Activity priority: high=red, medium=amber, low=slate
- [x] All badge colors have dark: mode variants

#### VR-010: Empty States
- [x] Shared `EmptyState` component created (`client/src/components/empty-state.tsx`)
- [x] Icon in teal-tinted rounded square + title + description + optional CTA button
- [x] Applied to: Accounts, Contacts, Leads, Activities pages
- [x] Consistent messaging: "No [entity] found. Create your first one to get started."

#### VR-011: Form Polish
- [x] Input fields: `hsl(186,18%,94%)` background (subtle teal tint), teal focus ring
- [x] Ring color updated to teal `hsl(186,78%,32%)` from previous amber
- [x] Border radius normalized to `--radius: 0.5rem` for all form elements

#### VR-012: Navigation Active States
- [x] Active sidebar item: `bg-white/15` pill background, white text + icon
- [x] Inactive: `text-white/65` with hover `text-white hover:bg-white/10`
- [x] Transition: `transition-colors duration-150`

#### VR-013: Border Radius Normalization
- [x] `--radius: 0.5rem` (8px) — professional, modern
- [x] Applied consistently across cards, buttons, inputs, badges via Tailwind radius utilities
- [x] Avatars: `rounded-full` in sidebar footer user section

#### VR-014: Login Page
- [x] Left panel: dark teal gradient with HT wordmark, tagline, and 4 feature highlights
- [x] Right panel: clean white background with Sign in / Create account tabs
- [x] Full-viewport height, responsive (mobile hides left panel)
- [x] Password mismatch validation with inline error message
- [x] Error states for failed login/register

---

## Work Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-03-02 | CR001 document created | ✅ Done | — |
| 2026-03-02 | T001: Schema — savedFilters table | ✅ Done | Table created, db:push run |
| 2026-03-02 | T002: Backend CRUD routes | ✅ Done | GET/POST/PUT/DELETE /api/saved-filters |
| 2026-03-02 | T003: SavedFiltersBar component | ✅ Done | saved-filters-bar.tsx with badges, dialog, rename, delete |
| 2026-03-02 | T004: Integrate into 5 pages | ✅ Done | Opportunities, Accounts, Contacts, Leads, Activities; E2E tested |
| 2026-03-02 | T005: CSS/Theme overhaul | ✅ Done | --radius 0.5rem, Inter font, real shadows, teal palette, ring/input fixes |
| 2026-03-02 | T006: Sidebar redesign | ✅ Done | Dark teal gradient, HT badge, white nav text, active pill, user footer |
| 2026-03-02 | T007: Dashboard & stat cards | ✅ Done | Teal icon squares, text-3xl bold metrics, p-6 spacing |
| 2026-03-02 | T008: Table, list & badge polish | ✅ Done | Semantic badge colors (all entities), EmptyState component, p-6 on all pages |
| 2026-03-02 | T009: Login page redesign | ✅ Done | Two-panel layout: teal left, white form right; mobile responsive |
