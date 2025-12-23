# UI Visual Description - Issue Detail Page

## Layout Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Issues                                                 │
├─────────────────────────────────────────────────────────────────┤
│ [Success/Error Message Banner - if present]                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ TITLE SECTION                                               │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Fix authentication bug                    [Edit Title]  │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │ Issue #123e4567                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ METADATA SECTION (2-column grid)                           │ │
│ │                                                             │ │
│ │ Status                  │ Priority                          │ │
│ │ [ACTIVE dropdown]       │ P0                                │ │
│ │                         │                                   │ │
│ │ Handoff State          │ GitHub Issue                      │ │
│ │ [SYNCED] ✓             │ [#42 ↗]                           │ │
│ │                         │                                   │ │
│ │ Created                │ Updated                           │ │
│ │ 23. Dez. 2023, 10:00  │ 23. Dez. 2023, 14:30             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ LABELS SECTION                                              │ │
│ │                                                             │ │
│ │ Labels                                                      │ │
│ │ [bug ×] [frontend ×] [priority-p0 ×]                       │ │
│ │                                                             │ │
│ │ [Add new label...___________________] [Add]                │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ DESCRIPTION SECTION                                         │ │
│ │                                                             │ │
│ │ Description                               [Preview/Edit]   │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Users unable to login after password reset.            │ │ │
│ │ │                                                         │ │ │
│ │ │ Steps to reproduce:                                     │ │ │
│ │ │ 1. Request password reset                               │ │ │
│ │ │ 2. Click reset link                                     │ │ │
│ │ │ 3. Enter new password                                   │ │ │
│ │ │ 4. Login fails                                          │ │ │
│ │ │                                                         │ │ │
│ │ │ Expected: User should be logged in                      │ │ │
│ │ │ Actual: Login form shows "Invalid credentials"          │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ACTIONS SECTION                                             │ │
│ │                                                             │ │
│ │ [Save Changes] [Activate] [Handoff to GitHub] [Open GH ↗] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Color Scheme (Dark Theme)

### Background Colors
- **Page Background**: `bg-gray-950` (very dark gray)
- **Card Background**: `bg-gray-900` (dark gray)
- **Section Background**: `bg-gray-800/30` (gray with 30% opacity)
- **Input Background**: `bg-gray-800` (medium dark gray)

### Text Colors
- **Primary Heading**: `text-purple-400` (purple - brand color)
- **Body Text**: `text-gray-100` (light gray)
- **Secondary Text**: `text-gray-300` (medium light gray)
- **Disabled/Muted**: `text-gray-500` (medium gray)

### Border Colors
- **Card Border**: `border-gray-800`
- **Input Border**: `border-gray-700`
- **Section Divider**: `border-gray-800`

### Status Badge Colors

#### Status Field
- **ACTIVE**: Green (`bg-green-900/30 text-green-200 border-green-700`)
- **DONE**: Blue (`bg-blue-900/30 text-blue-200 border-blue-700`)
- **BLOCKED**: Red (`bg-red-900/30 text-red-200 border-red-700`)
- **CREATED**: Gray (`bg-gray-700/30 text-gray-200 border-gray-600`)

#### Handoff State
- **SYNCED**: Green (`bg-green-900/30 text-green-200 border-green-700`)
- **SENT**: Yellow (`bg-yellow-900/30 text-yellow-200 border-yellow-700`)
- **FAILED**: Red (`bg-red-900/30 text-red-200 border-red-700`)
- **NOT_SENT**: Gray (`bg-gray-700/30 text-gray-200 border-gray-600`)

#### Labels
- All labels: Blue (`bg-blue-900/30 text-blue-200 border-blue-700`)

### Button Colors

#### Primary Action (Save Changes)
- Default: `bg-purple-600` with `text-white`
- Hover: `bg-purple-700`
- Disabled: `opacity-50`

#### Activate Button
- Default: `bg-green-600` with `text-white`
- Hover: `bg-green-700`
- Disabled: `opacity-50`

#### Handoff Button
- Default: `bg-blue-600` with `text-white`
- Hover: `bg-blue-700`
- Disabled: `opacity-50`

#### Secondary Button (Open GitHub)
- Default: `bg-gray-700` with `text-white`
- Hover: `bg-gray-600`

#### Edit/Cancel Buttons
- Edit Title: `bg-gray-800` hover `bg-gray-700`
- Save: `bg-purple-600` hover `bg-purple-700`
- Cancel: `bg-gray-700` hover `bg-gray-600`

### Message Banners

#### Success Message
- Background: `bg-green-900/20`
- Border: `border-green-700`
- Text: `text-green-300`
- Example: "Issue updated successfully"

#### Error Message
- Background: `bg-red-900/20`
- Border: `border-red-700`
- Text: `text-red-300`
- Example: "Failed to save changes"

#### Handoff Error Section
- Background: `bg-red-900/20`
- Border: `border-red-700`
- Text: `text-red-300`
- Only shown when handoff_state === "FAILED"

## Interactive States

### Title Editing Mode
```
┌───────────────────────────────────────────────────────────┐
│ [Fix authentication bug__________________________]        │
│ [Save] [Cancel]                                           │
└───────────────────────────────────────────────────────────┘
```

### Body Preview Mode
```
┌───────────────────────────────────────────────────────────┐
│ Description                                  [Edit]       │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Users unable to login after password reset.        │   │
│ │                                                     │   │
│ │ (Formatted text with preserved whitespace)         │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Body Edit Mode
```
┌───────────────────────────────────────────────────────────┐
│ Description                              [Preview]        │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Users unable to login after password reset.        │   │
│ │                                                     │   │
│ │ Steps to reproduce:_                               │   │
│ │                                                     │   │
│ │ (Editable textarea with monospace font)            │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Label Management
```
┌───────────────────────────────────────────────────────────┐
│ Labels                                                    │
│ [bug ×] [frontend ×] [priority-p0 ×]                     │
│                                                           │
│ [typescript___________________] [Add]                    │
└───────────────────────────────────────────────────────────┘
```

### Button States

#### Normal State
```
[Save Changes]  [Activate]  [Handoff to GitHub]
```

#### Loading State
```
[Saving...]  [Activating...]  [Handing off...]
```

#### Disabled State
```
[Save Changes]  [Already Active]  [Already Synced]
```

## Responsive Behavior

### Desktop (> 768px)
- 2-column grid for metadata
- Full-width sections
- Side-by-side buttons
- Max width: 1280px (5xl)

### Mobile (< 768px)
- Single-column metadata
- Stacked buttons
- Full-width inputs
- Maintained padding

## Typography

### Font Sizes
- **Title**: `text-3xl` (1.875rem / 30px)
- **Section Labels**: `text-sm` (0.875rem / 14px)
- **Body Text**: `text-base` (1rem / 16px)
- **Small Text**: `text-xs` (0.75rem / 12px)
- **Badge Text**: `text-xs` or `text-sm`

### Font Weights
- **Title**: `font-bold`
- **Section Labels**: `font-medium`
- **Buttons**: `font-medium`
- **Body Text**: Regular (default)

## Spacing

### Padding
- **Page**: `px-4 sm:px-6 lg:px-8 py-8`
- **Card**: `p-6`
- **Sections**: `p-6`
- **Inputs**: `px-3 py-2`
- **Buttons**: `px-4 py-2` or `px-6 py-2`

### Margins
- **Section Dividers**: `mb-6` or `border-b`
- **Field Labels**: `mb-2` or `mb-3`
- **Button Groups**: `gap-3`
- **Badge Groups**: `gap-1` or `gap-2`

## Accessibility Features

### Keyboard Navigation
- Tab through all form fields
- Enter to submit forms (label input)
- Focus states visible (purple ring)

### Screen Readers
- Semantic HTML (h1, label, button)
- Aria attributes where needed
- Clear button labels
- Error messages associated with fields

### Visual Indicators
- Clear focus states
- High contrast text
- Large click targets (44x44px minimum)
- Color not sole indicator (icons + color)

## Example Screen States

### Loading State
```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│                     ⟳ Loading issue...                    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### Error State
```
┌───────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────┐   │
│ │ ⚠ Error: Issue not found                           │   │
│ │                                                     │   │
│ │ ← Back to Issues                                    │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Success Message
```
┌───────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────┐   │
│ │ ✓ Issue updated successfully                        │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Handoff Error Detail
```
┌───────────────────────────────────────────────────────────┐
│ Handoff Error                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ GitHub API error: Rate limit exceeded. Please try   │   │
│ │ again in 30 minutes or use a different token.       │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

## Animation

### Transitions
- Button hover: `transition-colors`
- Input focus: `transition` with ring animation
- Success message: Auto-dismiss after 3 seconds

### Loading
- Spinner: `animate-spin` border animation
- Button text change: Instant

## Consistency with Existing UI

### Navigation Bar
- Same dark theme
- Same purple accent color
- Same font family
- Same hover effects

### Issues List Page
- Same badge colors
- Same card styling
- Same spacing
- Same dark background

### Forms Across App
- Same input styling
- Same button styling
- Same error handling
- Same success patterns
