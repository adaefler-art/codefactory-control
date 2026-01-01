# E74.3 UI Visual Guide

## CR Editor Component Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Change Request                          ○ DRAFT              │ ← Header
│ Hash: abc123def456789...                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  {                                                           │
│    "crVersion": "0.7.0",                                     │ ← JSON Editor
│    "canonicalId": "CR-2026-01-01-001",                       │   (Textarea)
│    "title": "Example Change Request",                        │
│    "motivation": "...",                                      │
│    ...                                                       │
│  }                                                           │
│                                                              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ [Save Draft]  [Validate]  [Reload]                          │ ← Actions
└─────────────────────────────────────────────────────────────┘
```

## With Validation Results (Invalid State)

```
┌─────────────────────────────────────────────────────────────┐
│ Change Request                          ✗ INVALID            │
│ Hash: def456789abc123...                                     │
├─────────────────────────────────────────────────────────────┤
│  {                                                           │
│    "crVersion": "0.7.0",                                     │
│    "title": "a".repeat(121),  ← Too long!                   │
│    "evidence": [],            ← Empty!                       │
│    ...                                                       │
│  }                                                           │
├─────────────────────────────────────────────────────────────┤
│ Validation Results: ✗ Invalid                                │
│                                                              │
│ Errors (2):                                                  │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ /title                                                   ││ ← Error 1
│ │ Title exceeds maximum length of 120 characters          ││
│ │ Code: CR_SIZE_LIMIT                                     ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────┐│
│ │ /evidence                                                ││ ← Error 2
│ │ At least one evidence entry is required                 ││
│ │ Code: CR_EVIDENCE_MISSING                               ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ ⚠ Validation Gate: Cannot generate issue until CR is    ││ ← Gate
│ │ valid. Fix all errors above and re-validate.            ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ Validated at: 1/1/2026 5:15:23 PM | Validator: v0.7.0      │
│ Hash: abc123...                                             │
├─────────────────────────────────────────────────────────────┤
│ [Save Draft]  [Validate]  [Reload]                          │
└─────────────────────────────────────────────────────────────┘
```

## With Validation Results (Valid State)

```
┌─────────────────────────────────────────────────────────────┐
│ Change Request                          ✓ VALID              │
│ Hash: 789abc123def456...                                     │
├─────────────────────────────────────────────────────────────┤
│  {                                                           │
│    "crVersion": "0.7.0",                                     │
│    "canonicalId": "CR-2026-01-01-001",                       │
│    "title": "Valid CR",                                      │
│    "evidence": [                                             │
│      { "kind": "github_issue", "number": 741, ... }          │
│    ],                                                        │
│    ...                                                       │
│  }                                                           │
├─────────────────────────────────────────────────────────────┤
│ Validation Results: ✓ Valid                                  │
│                                                              │
│ Warnings (1):                                                │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ /constraints/lawbookVersion                              ││ ← Warning
│ │ lawbookVersion is not specified in constraints           ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ Validated at: 1/1/2026 5:16:45 PM | Validator: v0.7.0      │
│ Hash: 789abc123def...                                       │
├─────────────────────────────────────────────────────────────┤
│ [Save Draft]  [Validate]  [Reload]                          │
└─────────────────────────────────────────────────────────────┘
```

## With Unsaved Changes

```
┌─────────────────────────────────────────────────────────────┐
│ Change Request        Unsaved changes     ○ DRAFT            │
│ Hash: abc123def456789...                                     │
├─────────────────────────────────────────────────────────────┤
│  {                                                           │
│    "crVersion": "0.7.0",                                     │
│    "title": "Editing..."  ← User is typing                  │
│    ...                                                       │
│  }                                                           │
├─────────────────────────────────────────────────────────────┤
│ [Save Draft]  [Validate]  [Reload]                          │
│  ↑ Enabled                                                   │
└─────────────────────────────────────────────────────────────┘
```

## Integration in INTENT Console

```
Full INTENT Console Layout with CR Drawer Open:

┌─────────────────────────────────────────────────────────────────────────┐
│ INTENT Console                                                          │
│ Session: My Session                                                     │
│ [Change Request] [View Packs] [Export Context Pack]                    │
├───────┬──────────────────────────────────────┬──────────────────────────┤
│       │                                      │                          │
│ Sess- │ Chat Area                            │ CR Drawer (600px)        │
│ ions  │                                      │ ┌──────────────────────┐ │
│       │ User: Help me create a CR            │ │ Change Request       │ │
│ My    │                                      │ │ ○ DRAFT              │ │
│ Sess- │ Assistant: Sure! Here's what         │ │ Hash: abc123...      │ │
│ ion   │ you need...                          │ ├──────────────────────┤ │
│ ●     │                                      │ │ {                    │ │
│       │ [Type message...]                    │ │   "crVersion": ...   │ │
│ Other │                                      │ │   ...                │ │
│ Sess- │                                      │ │ }                    │ │
│ ion   │                                      │ ├──────────────────────┤ │
│       │                                      │ │ [Save] [Validate]    │ │
│       │                                      │ └──────────────────────┘ │
└───────┴──────────────────────────────────────┴──────────────────────────┘
```

## Status Badge Colors

```
○ DRAFT     - Yellow background (bg-yellow-100, text-yellow-800)
✓ VALID     - Green background  (bg-green-100, text-green-800)
✗ INVALID   - Red background    (bg-red-100, text-red-800)
```

## Button States

```
[Save Draft]
- Enabled: Blue background (bg-blue-600, hover:bg-blue-700)
- Disabled: Gray background (bg-gray-300) when no unsaved changes

[Validate]
- Enabled: Green background (bg-green-600, hover:bg-green-700)
- Disabled: Gray background (bg-gray-300) when validating

[Reload]
- Always enabled: Gray background (bg-gray-200, hover:bg-gray-300)
```

## Error Display Format

```
Error Box (Red):
┌────────────────────────────────────────┐
│ /path/to/field                         │ ← Monospace path
│ Human-readable error message           │ ← Regular text
│ Code: ERROR_CODE_NAME                  │ ← Code reference
└────────────────────────────────────────┘
Background: bg-red-50
Border: border-red-200
Text: text-red-900 (path), text-red-700 (message)
```

## Warning Display Format

```
Warning Box (Yellow):
┌────────────────────────────────────────┐
│ /path/to/field                         │
│ Human-readable warning message         │
└────────────────────────────────────────┘
Background: bg-yellow-50
Border: border-yellow-200
Text: text-yellow-900 (path), text-yellow-700 (message)
```

## Validation Gate Message

```
Gate Box (Orange):
┌────────────────────────────────────────┐
│ ⚠ Validation Gate: Cannot generate    │
│ issue until CR is valid. Fix all      │
│ errors above and re-validate.         │
└────────────────────────────────────────┘
Background: bg-orange-50
Border: border-orange-200
Text: text-orange-700
```

## Color Palette Used

```
Indigo (CR Button):     bg-indigo-600, hover:bg-indigo-700
Blue (Save):            bg-blue-600, hover:bg-blue-700
Green (Validate/Valid): bg-green-600, hover:bg-green-700
                        bg-green-100, text-green-800 (badge)
Yellow (Draft):         bg-yellow-100, text-yellow-800 (badge)
                        bg-yellow-50, border-yellow-200 (warnings)
Red (Invalid):          bg-red-100, text-red-800 (badge)
                        bg-red-50, border-red-200 (errors)
Orange (Gate):          bg-orange-50, border-orange-200
                        text-orange-600 (unsaved indicator)
Gray (Reload/Disabled): bg-gray-200, bg-gray-300
```

## Responsive Behavior

- CR Drawer: Fixed 600px width
- Scrollable: JSON editor and validation results independently scrollable
- Mobile: Not optimized (desktop-first implementation)
