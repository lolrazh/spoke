# Agent Logging Rules

## File Naming Convention
**Pattern:** `YYYY-MM-DD_HHMM_descriptive-task.md`

**Examples:**
- `2025-08-20_1245_websocket-implementation.md`
- `2025-08-21_0900_auth-debugging.md`  
- `2025-08-22_1430_performance-optimization.md`

**Rules:**
- Use 24-hour time format (HHMM)
- Use kebab-case for descriptive part (lowercase, hyphens)
- Keep description to 1-3 words that capture the main task
- Files will self-organize chronologically when sorted alphabetically

## Content Structure Template

```markdown
# [Descriptive Session Title]

**Date:** YYYY-MM-DD  
**Agent:** [Model Name]  
**Status:** [✅ Completed | ⚠️ Partial | ❌ Failed | 🔄 Ongoing]  

## User Intention
[2-3 sentences describing what the user actually wanted to achieve, inferred from all their requests and context. Not just their first message, but the underlying goal.]

## What We Accomplished
- ✅ **[Major deliverable]** - Brief description of what was built/fixed
- ✅ **[Major deliverable]** - Brief description of what was built/fixed
- ⚠️ **[Partial item]** - What was attempted and current state

## Technical Implementation
[Key technical details, architecture decisions, code patterns used]

**Files Modified:**
- `file/path.ext` - What was changed
- `another/file.ext` - What was changed

## Bugs & Issues Encountered
1. **[Bug description]** - What went wrong and symptoms
   - **Fix:** How it was resolved
2. **[Issue description]** - Problem encountered
   - **Workaround:** Temporary or permanent solution

## Key Learnings
- **[Technical insight]** - Important discovery or gotcha
- **[Architecture lesson]** - Design pattern or decision rationale
- **[Tool/library insight]** - How something works or behaves

## Architecture Decisions
- **[Decision]** - Why this approach was chosen over alternatives
- **[Trade-off]** - What was sacrificed and why it was acceptable

## Ready for Next Session
- ✅ **[Prepared item]** - What's ready to be built upon
- 🔧 **[Needs work]** - What requires attention before proceeding

## Context for Future
[1-2 sentences about how this work fits into the bigger picture and what it enables for future sessions]
```

## Writing Guidelines

### User Intention Section
- **Don't:** Copy their exact first request
- **Do:** Infer their true goal from all interactions
- **Example:** Instead of "user wants websockets", write "User wanted to replace HTTP transcription with WebSocket-only approach for real-time capabilities"

### What We Accomplished Section  
- Use checkboxes (✅ ⚠️ ❌) for visual scanning
- Lead with the deliverable, follow with brief technical detail
- Group related accomplishments together

### Bugs & Issues Section
- Always include the fix or resolution
- Be specific about symptoms and root cause
- Help future agents avoid the same problems

### Key Learnings Section
- Focus on non-obvious insights
- Include gotchas that weren't in documentation
- Note behavioral quirks of tools/libraries/APIs

### Context for Future Section
- Think about the next person who picks up this work
- What do they need to know to continue effectively?
- How does this fit into larger architecture goals?

## Quality Standards
- **Scannable:** Use headers, bullets, checkboxes for easy navigation
- **Actionable:** Include enough detail to reproduce or build upon
- **Honest:** Document failures and partial solutions clearly  
- **Forward-looking:** Help future sessions start efficiently
- **Technical:** Include code patterns, file paths, specific configurations

## File Management
- Store in `agent-logs/` directory at project root
- Never overwrite existing logs - create new files for new sessions
- Reference previous logs when continuing work: "Building on 2025-08-20_1245_websocket-implementation.md"