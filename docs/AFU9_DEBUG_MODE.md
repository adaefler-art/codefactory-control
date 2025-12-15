# AFU-9 Debug Mode

## Purpose
Enable disciplined, repeatable debugging for AFU-9 production-like environments with minimal blast radius and clear handoffs.

## Standard Flow
1. Test execution: run the failing scenario or smoke test with Debug Mode enabled.
2. Raw output capture: collect console output, HTTP responses, and task/event logs without filtering.
3. Analysis agent: summarize signals from logs/events only, identify suspects, and map to components.
4. Copilot prompt generation: craft a focused prompt that cites evidence and desired change scope.
5. Coding agent: implement minimal diffs guided by the prompt, keeping changes scoped to the evidence.

## Rules
- Logs are truth; claims must cite captured evidence.
- No speculation; unanswered questions become explicit follow-ups.
- Minimal diffs only; avoid opportunistic refactors.
- Separate analysis from implementation; do not mix diagnosis text into code changes.
