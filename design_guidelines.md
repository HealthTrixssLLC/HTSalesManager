# Design Guidelines: Lightweight Self-Hosted CRM

## Design Approach

**Selected Approach**: Design System (Linear-inspired modern enterprise SaaS)

**Rationale**: This is a utility-focused, information-dense productivity application requiring efficiency, data clarity, and professional consistency. Linear's design system excels at complex data workflows with clean hierarchy and modern aesthetics—perfect for an enterprise CRM replacing Dynamics 365.

**Key Design Principles**:
- **Clarity over decoration**: Every element serves a functional purpose
- **Information density with breathing room**: Maximize data visibility while maintaining readability
- **Consistent, predictable patterns**: Users should learn once, apply everywhere
- **Professional trustworthiness**: Enterprise-grade polish throughout

---

## Typography

**Font Stack**:
- **Primary**: Inter (via Google Fonts CDN) for UI elements, forms, tables
- **Secondary**: Inter for all text (monolithic font approach for consistency)

**Hierarchy**:
- **Page Headers**: 2xl font-weight-600
- **Section Headers**: xl font-weight-600
- **Card/Widget Headers**: lg font-weight-500
- **Table Headers**: sm font-weight-500 uppercase tracking-wide
- **Body Text**: base font-weight-normal
- **Supporting/Meta Text**: sm font-weight-normal
- **Labels**: sm font-weight-500
- **Buttons**: sm font-weight-500

---

## Layout System

**Spacing Primitives**: Use Tailwind units consistently
- **Primary spacing**: 4, 6, 8 (p-4, p-6, p-8, m-4, gap-6, etc.)
- **Micro spacing**: 2, 3 for tight elements (gap-2, px-3)
- **Macro spacing**: 12, 16 for major sections (py-12, mb-16)

**Grid Structure**:
- **Main container**: max-w-7xl mx-auto px-6
- **Dashboard widgets**: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- **Data tables**: full-width with horizontal scroll on mobile
- **Forms**: max-w-2xl for single-column, max-w-4xl for two-column layouts
- **Sidebar**: fixed w-64 on desktop, collapsible mobile drawer

**Page Structure**:
- **App Shell**: Fixed sidebar navigation (64 units wide) + top bar (16 units tall) + main content area
- **Content padding**: p-6 on desktop, p-4 on mobile
- **Cards**: rounded-lg with consistent p-6 padding

---

## Component Library

### Navigation & Shell

**Sidebar Navigation**:
- Fixed left sidebar with logo at top, primary nav items with icons, user profile at bottom
- Active state: subtle background highlight with border accent
- Icons from Heroicons (outline style) via CDN
- Sections: Dashboard, Leads, Accounts, Contacts, Opportunities, Activities, Reports, Admin
- Collapsible on mobile to hamburger menu

**Top Bar**:
- Fixed header with breadcrumb trail, global search, notifications icon, user avatar menu
- Breadcrumbs: Home > Accounts > Account Name
- Height: h-16 with px-6 padding

**Page Headers**:
- Title (2xl font-weight-600), optional subtitle, action buttons aligned right
- mb-6 spacing before content

### Data Display

**Tables**:
- Full-width with alternating row backgrounds for readability
- Sticky headers on scroll
- Column headers: uppercase text-sm font-weight-500 with sort indicators
- Row height: py-4 px-6 for comfortable touch targets
- Hover state: subtle background change
- Pagination controls at bottom (previous/next, page numbers, items per page)
- Inline action buttons (edit, delete) on row hover
- Filters bar above table: flex layout with select dropdowns, search input, clear filters button

**Cards/Widgets**:
- Rounded-lg borders with p-6 padding
- Header: title (lg font-weight-500) with optional action icon/dropdown
- Content area with appropriate spacing
- Stats display: large number (3xl font-weight-600) with label below (sm)

**Kanban Board**:
- Horizontal scrolling columns with fixed width (320px per column)
- Column headers with count badges
- Cards: p-4, rounded-md, draggable cursor, with title, metadata (amount, owner), and due date
- Empty state: dashed border placeholder in columns

**Activity Timeline**:
- Vertical line with timeline dots
- Entry: icon + timestamp + actor + action description
- Spacing: gap-4 between entries, pl-8 for content indent

**Dashboard Layout**:
- Grid of stat cards at top: 4 columns on desktop showing key metrics (pipeline value, open leads, win rate, activities)
- Chart widgets below: 2-column grid with flexible heights
- Charts: Simple bar/line visualizations using SVG (no color specification)

### Forms & Inputs

**Form Layouts**:
- Two-column grid on desktop (grid-cols-2 gap-6), single column on mobile
- Full-width fields for long inputs (descriptions, addresses)
- Fieldset groups with subtle separation (border-t pt-6 mt-6)

**Input Fields**:
- Label above input: text-sm font-weight-500 mb-2
- Input: h-10 px-3 rounded-md with full border
- Focus state: ring outline
- Error state: border change with error message below (text-sm)
- Helper text: text-sm below input when needed

**Select Dropdowns**:
- Match input styling with chevron-down icon
- Custom dropdown menu: absolute positioning, rounded-md, max-h-60 overflow-auto

**Buttons**:
- Primary: px-4 py-2 rounded-md font-weight-500 (for main actions)
- Secondary: same size with outline/ghost style
- Sizes: sm (px-3 py-1.5 text-sm), base (px-4 py-2), lg (px-6 py-3)
- Icon buttons: square aspect ratio with icon centered
- Button groups: flex gap-2

**Search Inputs**:
- Leading magnifying glass icon from Heroicons
- h-10 with pl-10 for icon space, rounded-md

### Modals & Overlays

**Modal Dialogs**:
- Backdrop: fixed inset-0 with backdrop blur
- Dialog: centered, max-w-lg to max-w-2xl depending on content, rounded-lg, p-6
- Header: flex justify-between with close X button
- Footer: flex justify-end gap-3 with action buttons
- Examples: Lead Conversion Wizard (multi-step with progress indicator), Delete Confirmation, Settings panels

**Dropdowns & Menus**:
- Absolute positioning from trigger
- Rounded-md with py-2
- Menu items: px-4 py-2 with hover state
- Dividers between logical groups

**Toasts/Notifications**:
- Fixed bottom-right or top-right positioning
- Success/error/info variants (without color specification)
- Auto-dismiss after 5 seconds with close button
- Stack multiple notifications vertically (gap-2)

### Admin Console

**Configuration Panels**:
- Left sidebar with admin sections (Users, Roles, Permissions, ID Patterns, Backup/Restore, System Settings)
- Main content area with tabs for sub-sections
- ID Pattern configurator: code-style input for pattern tokens, preview panel showing next ID
- User management: table with inline edit, role assignment dropdown
- Backup controls: action buttons with status indicators, archive list table

**Database Reset**:
- Multi-step confirmation flow with escalating warnings
- Re-authentication prompt before final action
- Progress indicator during reset

---

## Animations

Use **minimal, purposeful animations**:
- **Transitions**: 150ms-200ms for hover states, dropdowns, modal appearances
- **Loading states**: Subtle pulse or spinner on data fetch
- **Drag feedback**: Slight scale or opacity change on Kanban card drag
- **Page transitions**: None (instant navigation for productivity)

**Avoid**: Unnecessary scroll animations, parallax, decorative motion

---

## Images

**No hero images**: This is a productivity application—users land directly into their dashboard workspace.

**User avatars**: Small circular images (h-8 w-8) in navigation, tables, activity timelines

**Empty states**: Simple illustration or icon (from Heroicons) with explanatory text for empty lists/boards

**Logo placement**: Health Trixss logo in sidebar top (h-8 or h-10) and login screen

---

## Responsive Behavior

**Desktop (lg and up)**:
- Sidebar visible, two/three-column layouts, expanded data tables

**Tablet (md)**:
- Sidebar collapsible, two-column layouts, full-width tables with horizontal scroll

**Mobile (base)**:
- Hamburger menu, single-column layouts, stacked cards, simplified tables (card view alternative)
- Bottom tab bar for quick navigation to Dashboard, Leads, Opportunities, More

---

## Special Features

**Lead Conversion Wizard**:
- Step indicator at top (3 steps: Duplicate Check → Field Mapping → Confirm)
- Each step in modal format with previous/next navigation
- Preview panel showing what will be created

**Opportunity Stages**:
- Configurable in admin: stage name, probability %, transition rules
- Visual representation in Kanban columns

**Audit Log Viewer**:
- Filterable table with expandable rows showing before/after JSON diffs
- Syntax-highlighted code blocks for data changes

**Backup Archive List**:
- Table with archive name, size, checksum, status badge, restore/download actions

This design system creates a professional, efficient, data-focused CRM that prioritizes user productivity while maintaining Health Trixss branding throughout.