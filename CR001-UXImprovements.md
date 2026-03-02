# Change Request CR001 — UX Improvements
**Status**: In Progress  
**Created**: 2026-03-02  
**Last Updated**: 2026-03-02 (T001–T004 Saved Filter Presets — All Completed & Tested)

---

## 1. Saved Filter Presets

### Summary
Users on all list pages (Opportunities, Accounts, Contacts, Leads, Activities) can save their current filter state as a named preset. One preset per page can be marked as **Default** and will be automatically applied when that page is loaded.

### Requirements

#### FR-001: Save Filter Preset
- Users can save the current filter state on any page that has filters
- Saving opens a dialog asking for a preset name
- A "Set as default" checkbox is available in the save dialog
- Saved presets are **per user** — each user has their own presets

#### FR-002: Default Preset Auto-Apply
- One preset per user per page can be marked as **Default**
- When a page loads and the user has no active filters set, the default preset is automatically applied
- Setting a new default clears the previous default for that page
- The default preset is visually distinguished with a "Default" badge

#### FR-003: Apply Saved Presets
- Saved presets appear as clickable chips/badges in a bar below the page header
- Clicking a preset chip immediately applies all those filter values
- The currently active preset (if any) is highlighted

#### FR-004: Manage Presets
- Users can rename a preset via a context menu on the chip
- Users can change which preset is the default via context menu
- Users can delete a preset via context menu

#### FR-005: Pages Covered
- Opportunities (filterAccount, closeDateFrom, closeDateTo, probabilityMin, probabilityMax, rating, tagIds, includeInForecast)
- Accounts (search, type, category, ownerId, tagIds)
- Contacts (search, accountId, ownerId, hasEmail, tagIds)
- Leads (search, status, rating, ownerId, tagIds)
- Activities (type, status, priority, ownerId, dateFrom, dateTo, tagIds)

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
- Sidebar background: deep teal gradient (`from-[hsl(186,60%,18%)] to-[hsl(186,55%,22%)]`)
- "Health Trixss" wordmark with HT icon badge at top — white on dark teal
- Navigation items: icon + label, white/70% opacity when inactive, white/100% + teal pill accent when active
- Bottom section: user avatar, name, role — separated by a subtle border
- Sidebar width: 240px
- Subtle top-to-bottom gradient with a very slight right-edge glow

#### VR-002: Top Bar / Header Area
- Remove or minimize standalone top bar — integrate breadcrumb/title into each page's own header
- Each page header: large bold page title (2xl, font-semibold), subtitle in muted teal, action buttons right-aligned
- Light background, subtle bottom border

#### VR-003: Cards
- Cards: white background with very subtle teal-tinted border (`hsl(186,25%,88%)`)
- Border radius: `rounded-xl` (not the current overly large radius)
- Slight shadow: `shadow-sm` with teal-tinted shadow color
- Stat cards on dashboard: left accent stripe in primary teal, or top gradient fade

#### VR-004: Typography
- Font: Inter (already loaded) — not Open Sans
- Page title: `text-2xl font-semibold text-foreground`
- Section headers: `text-lg font-medium`
- Table headers: `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- Metric numbers on dashboard: `text-3xl font-bold`

#### VR-005: Color Palette Refinement
- Background: clean white (`#ffffff`) with a very faint teal tint on sidebar/nav areas
- Surface (cards): `hsl(186, 45%, 98%)` — nearly white with teal warmth
- Border: `hsl(186, 25%, 88%)` — soft teal-tinted border
- Primary actions: `hsl(186, 78%, 32%)` teal buttons — white text
- Destructive: warm red `hsl(356, 90%, 54%)`
- Success: `hsl(142, 71%, 45%)`
- Warning: amber `hsl(38, 100%, 50%)`

#### VR-006: Dashboard Stat Cards
- 4-column grid of stat cards with:
  - Icon in a teal-tinted rounded square
  - Large metric number (3xl bold)
  - Label and subtitle
  - Subtle trend indicator
- Cards have a very light teal-to-white gradient background

#### VR-007: Tables
- Alternating row backgrounds: white / `hsl(186, 45%, 98%)`
- Row hover: `hsl(186, 45%, 95%)`
- Sticky column headers with subtle bottom border
- Row actions revealed on hover (edit/view/delete buttons)
- Cleaner pagination controls

#### VR-008: Buttons
- Primary: solid teal, white text, subtle shadow
- Secondary/Outline: teal border, teal text, white background
- Ghost: transparent, teal text on hover
- Destructive: warm red
- Size consistency across the app

#### VR-009: Badges & Status Indicators
- Pipeline stage badges: each stage gets a distinct, accessible color from the data palette
- Lead status: Hot = warm red/orange, Warm = amber, Cold = blue-gray
- Activity status: pending = amber, completed = green, cancelled = muted
- Smaller, tighter badges with `rounded-md` (not pill-shaped unless intentional)

#### VR-010: Empty States
- Illustrated empty states on list pages using a simple SVG icon + title + subtitle + CTA button
- Consistent messaging: "No [entity] yet. Create your first one to get started."

#### VR-011: Form Polish
- Input fields: clean border with teal focus ring
- Dropdown selects: consistent styling matching inputs
- Form sections with dividers for multi-section forms
- Required field indicators (asterisk) in teal

#### VR-012: Navigation Active States
- Active sidebar item: pill-shaped teal background, white text + icon
- Hover: very subtle lighter teal background
- Transition: 150ms ease

#### VR-013: Border Radius Normalization
- Current: `--radius: 1.3rem` is far too large for enterprise SaaS
- New: `--radius: 0.5rem` (8px) — professional, modern, not boxy
- Cards: `rounded-xl` (12px)
- Buttons/inputs: `rounded-lg` (8px)  
- Badges: `rounded-md` (6px)
- Avatars/icons: `rounded-full` where circular, `rounded-lg` for square

#### VR-014: Login Page
- Centered two-panel layout
- Left: teal gradient panel with HT logo, tagline, and subtle decorative pattern
- Right: clean white panel with login form
- Full-viewport height

### Implementation Order
1. CSS/theme variables (index.css) — border radius, color refinements
2. Sidebar redesign (app-sidebar component)
3. Dashboard stat card improvements
4. Table and list page polish
5. Login page redesign

---

## Work Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-03-02 | CR001 document created | Done | — |
| 2026-03-02 | T001: Schema — savedFilters table | Done | Table created, db:push run |
| — | T002: Backend CRUD routes | Pending | — |
| — | T003: SavedFiltersBar component | Pending | — |
| — | T004: Integrate into 5 pages | Pending | — |
| — | T005: CSS/Theme overhaul | Pending | — |
| — | T006: Sidebar redesign | Pending | — |
| — | T007: Dashboard & stat cards | Pending | — |
| — | T008: Table & list polish | Pending | — |
| — | T009: Login page redesign | Pending | — |
