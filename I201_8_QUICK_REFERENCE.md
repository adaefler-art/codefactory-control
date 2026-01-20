# I201.8 - INTENT Chat Command Router: Quick Reference

## Usage Guide

### Chat Commands

Type these commands in the INTENT chat to execute actions directly:

#### Validate Draft
```
validate
validiere
prüfe
check
```
**Action**: Validates the current issue draft  
**Result**: Shows validation status (VALID/INVALID) with error/warning counts

#### Commit Version
```
commit
commit version
committe
versioniere
```
**Action**: Commits a new version of the issue draft  
**Result**: Confirms version committed successfully

#### Publish to GitHub
```
publish
publish to github
github
handoff
```
**Action**: Publishes committed draft version(s) to GitHub  
**Result**: Shows batch ID and summary (created/updated/failed counts)

#### Create AFU-9 Issue
```
create issue
create afu9 issue
issue anlegen
```
**Action**: Creates an AFU-9 issue from the committed draft  
**Result**: Shows issue ID, canonical ID, and state

#### Copy Snippet
```
copy snippet
export
copy
```
**Action**: Not supported in chat (use button instead)  
**Result**: Shows message to use button in Issue Draft panel

### Command Features

- ✅ **Case-Insensitive**: Commands work in any case (VALIDATE, validate, Validate)
- ✅ **Whitespace Tolerant**: Extra spaces/newlines are ignored
- ✅ **DE/EN Support**: Both German and English commands supported
- ✅ **Exact Matching**: Only exact commands trigger actions (prevents false positives)

### Examples

#### Success Flow
```
User: validate
System: ✅ ACTION_VALIDATE executed
        Status: VALID
        Errors: 0
        Warnings: 0

User: commit
System: ✅ ACTION_COMMIT_VERSION executed
        Draft version committed successfully.

User: publish to github
System: ✅ ACTION_PUBLISH_TO_GITHUB executed
        Batch ID: abc123def456...
        Total: 1, Created: 1, Updated: 0, Failed: 0
```

#### Error Flow
```
User: commit
System: ❌ ACTION_COMMIT_VERSION failed
        Error: Draft must be valid before committing
        Request ID: req_xyz789

User: publish
System: ❌ ACTION_PUBLISH_TO_GITHUB failed
        Error: No committed versions found
        Request ID: req_abc123
```

#### Fallback to LLM
```
User: Can you help me validate this?
[Normal LLM response - not detected as command]

User: I want to publish the draft
[Normal LLM response - not detected as command]
```

### Command vs Button

| Feature | Chat Command | Button |
|---------|-------------|--------|
| Execute Action | ✅ | ✅ |
| Show Confirmation | ✅ | ✅ |
| Refresh Draft | ✅ | ✅ |
| Error Handling | ✅ | ✅ |
| RequestID Tracking | ✅ | ✅ |
| **Consistency** | **Same action handlers** | **Same action handlers** |

### Tips

1. **Exact Commands Only**: Type the exact command word(s) for best results
2. **Check Draft First**: Some commands require a valid draft (validate before commit/publish)
3. **Use Buttons for Complex UI**: Copy snippet works better via button (clipboard access)
4. **Request ID for Support**: Include the Request ID when reporting errors

### Troubleshooting

**Q: Command doesn't work?**
- Check spelling (exact match required)
- Try lowercase version
- Look for system message confirming detection

**Q: Action failed?**
- Check error message for reason
- Verify draft status (validate first)
- Note Request ID for support

**Q: LLM responds instead of action?**
- Use exact command word only
- Remove extra words ("validate" not "please validate")
- Check supported commands list

### PowerShell Commands for Verification

After making code changes, verify with:

```powershell
# Run tests
npm --prefix control-center test -- __tests__/lib/intent/chatCommandRouter.test.ts

# Build
npm --prefix control-center run build

# Repository verification
npm run repo:verify
```

### Related Files

- **Command Router**: `control-center/src/lib/intent/chatCommandRouter.ts`
- **Actions**: `control-center/src/lib/intent/issueDraftActions.ts`
- **Chat Integration**: `control-center/app/intent/page.tsx`
- **Tests**: `control-center/__tests__/lib/intent/chatCommandRouter.test.ts`

### Architecture

```
User Input
    ↓
detectCommand() → CommandType | null
    ↓
    ├─ Command detected → executeCommand()
    │      ↓
    │   Action handlers (issueDraftActions.ts)
    │      ↓
    │   API calls (/api/intent/...)
    │      ↓
    │   System message (✅/❌)
    │      ↓
    │   Refresh draft
    │
    └─ No command → sendMessage()
           ↓
        /api/intent/messages (LLM)
```

### Issue Reference

- **Canonical ID**: I201.8
- **Epic**: E201 (INTENT / IssueDraft Flow)
- **Priority**: P0
- **Status**: ✅ Implemented
