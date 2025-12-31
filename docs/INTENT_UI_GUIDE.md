# INTENT Console UI - Visual Guide

## Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Navigation Bar (existing Control Center navigation)                   │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┬──────────────────────────────────────────────────────┐
│                  │                                                      │
│  SIDEBAR         │  MAIN CHAT AREA                                      │
│  (Sessions)      │                                                      │
│                  │                                                      │
│ ┌──────────────┐ │ ┌──────────────────────────────────────────────────┐ │
│ │ + New Session│ │ │ Header: Session Title                            │ │
│ └──────────────┘ │ │ Session-based chat interface for INTENT steering │ │
│                  │ └──────────────────────────────────────────────────┘ │
│ ┌──────────────┐ │                                                      │
│ │ ● New Conver │ │ ┌────────────────────────────────────────────────┐ │
│ │   2 mins ago │ │ │                                                │ │
│ └──────────────┘ │ │  MESSAGE THREAD                                │ │
│                  │ │  (Auto-scrolls to bottom)                      │ │
│ ┌──────────────┐ │ │                                                │ │
│ │   Test Sess  │ │ │  ┌───────────────────────┐                    │ │
│ │   1 hour ago │ │ │  │ User Message          │                    │ │
│ └──────────────┘ │ │  │ (Blue, right-aligned) │                    │ │
│                  │ │  └───────────────────────┘                    │ │
│ ┌──────────────┐ │ │                                                │ │
│ │   Hello wor  │ │ │  ┌────────────────────────┐                   │ │
│ │   3 days ago │ │ │  │ Assistant Response     │                   │ │
│ └──────────────┘ │ │  │ (White, left-aligned)  │                   │ │
│                  │ │  └────────────────────────┘                   │ │
│                  │ │                                                │ │
│                  │ └────────────────────────────────────────────────┘ │
│                  │                                                      │
│                  │ ┌──────────────────────────────────────────────────┐ │
│                  │ │ [Input Box]                                      │ │
│                  │ │ Type a message...                        [Send]  │ │
│                  │ └──────────────────────────────────────────────────┘ │
│                  │                                                      │
└──────────────────┴──────────────────────────────────────────────────────┘
```

## UI Components

### Sidebar (Left, 256px width)
- **New Session Button** (Top)
  - Blue background (#3B82F6)
  - Full width, rounded corners
  - Creates new session on click

- **Session List** (Scrollable)
  - Each session shows:
    - Title (from first message or "New Conversation")
    - Last updated timestamp
  - Active session highlighted with blue left border
  - Hover effect for better UX

### Main Area (Right, flex-1)

#### Header
- Session title (or "INTENT Console" if no session)
- Subtitle: "Session-based chat interface for INTENT steering"

#### Message Thread (Scrollable)
- User messages:
  - Blue background (#2563EB)
  - White text
  - Right-aligned
  - Rounded corners
  - Timestamp below

- Assistant messages:
  - White background with border
  - Gray text (#111827)
  - Left-aligned
  - Rounded corners
  - Timestamp below

- Loading indicator:
  - Gray background
  - "Generating response..." text

#### Input Area (Bottom)
- Multi-line textarea (2 rows)
- Placeholder: "Type a message... (Enter to send, Shift+Enter for new line)"
- Send button on the right
  - Blue when active
  - Gray when disabled
  - Shows "Sending..." during submission

## Color Scheme
- Primary Blue: #3B82F6 (buttons, user messages)
- Dark Blue: #2563EB (user message backgrounds)
- Background: #F9FAFB (gray-50)
- White: #FFFFFF (main areas, assistant messages)
- Border: #E5E7EB (gray-200)
- Text: #111827 (gray-900)
- Light Text: #6B7280 (gray-500)

## Interactions

### Keyboard Shortcuts
- **Enter**: Send message
- **Shift+Enter**: New line in message

### User Flow
1. User lands on /intent
2. Sees "Create a new session or select an existing one"
3. Clicks "+ New Session"
4. Types message and presses Enter
5. User message appears (right-aligned, blue)
6. Loading indicator shows
7. Assistant reply appears (left-aligned, white)
8. Session title auto-updates to first message
9. Can continue conversation or switch sessions

### Error Handling
- Red banner at bottom shows errors
- Input restored on send failure
- Graceful degradation if session not found

## Responsive Behavior
- Sidebar: Fixed 256px width
- Main area: Flexible, grows with window
- Messages: Max width 2xl (42rem)
- Scrolling: Vertical only, auto-scroll to bottom
