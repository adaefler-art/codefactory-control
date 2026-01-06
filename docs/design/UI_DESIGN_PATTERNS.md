# UI Design Patterns - Quick Reference

**Version**: 1.0  
**Date**: 2026-01-06  
**Scope**: AFU-9 Control Center

---

## Color System

**Severity**: Critical→Red, High→Orange, Medium→Yellow, Low→Blue, Info→Gray  
**Status**: Success→Green, Running→Blue, Pending→Yellow, Failed→Red, Disabled→Gray  
**Environment**: Prod→Red, Stage→Yellow, Dev→Blue

## When to Use

- **Tables**: Ops/admin pages, sortable data, >5 columns
- **Cards**: Dashboard, <5 items, rich content
- **Badges**: Status, severity, environment indicators
- **Banners**: System messages, warnings, errors

## Accessibility

- Keyboard navigation (Tab, Enter, Escape)
- Semantic HTML (`<button>`, `<a>`, `<nav>`)
- `aria-label` for icon-only buttons
- Focus indicators (never remove without alternative)

---

**Full Patterns**: See detailed component patterns and code examples (to be added).  
**Component Library**: Future work - standardize into reusable components.
