# Customer Portal Integration & Payments Cleanup

**Date:** 2025-12-05  
**Agent:** Gemini (Antigravity)  
**Status:** ✅ Completed  

## User Intention
The user wanted to complete two main objectives: (1) Review the legacy `PAYMENTS_BLUEPRINT.md` to ensure nothing was missed in the actual implementation, then clean it up if obsolete, and (2) Implement the "Manage" button in the Pro user UI to link to the Dodo customer portal, coordinating with another agent (Opus) working on the website side to create the necessary API endpoint.

## What We Accomplished
- ✅ **Reviewed PAYMENTS_BLUEPRINT.md** - Confirmed all items were either implemented or superseded by better solutions (JWT claims, server-authoritative quota)
- ✅ **Deleted obsolete blueprint** - Removed `plans/PAYMENTS_BLUEPRINT.md` as it was fully captured in `docs/PAYMENTS.md`
- ✅ **Explained subscription cancellation flow** - Documented how cancellation works through the existing webhook system
- ✅ **Designed customer portal architecture** - Recommended industry-standard pattern (fetch + open) matching Stripe's billing portal approach
- ✅ **Implemented Manage button** - App now opens billing portal via website redirect page
- ✅ **Fixed CSP blocking** - Added `https://www.sonicflow.app` to Content Security Policy
- ✅ **Optimized UX** - Changed from "fetch then open" to "open immediately with redirect" for instant perceived responsiveness
- ✅ **Updated PAYMENTS.md** - Added Customer Portal section with architecture diagram and endpoint documentation

## Technical Implementation

### Customer Portal Flow (Final)

```
User clicks "Manage" → App opens browser instantly with token in hash
     ↓
https://www.sonicflow.app/billing/portal#token=<jwt>
     ↓
Website page reads hash, shows loading, calls API
     ↓
Redirects to Dodo customer portal
```

**Why hash fragment?** Token not sent to server logs (security), but still readable by client-side JavaScript.

**Why instant open?** Moving latency to browser where users expect page load, rather than making app feel slow with 2-second fetch delay.

### Files Modified

**App:**
- `src/main.ts` - Added `https://www.sonicflow.app` to CSP connect-src (line 2688)
- `src/components/SettingsPanel.tsx` - Implemented `handleManageSubscription()` with instant browser open pattern
- `docs/PAYMENTS.md` - Added Customer Portal section with architecture and changelog

**Deleted:**
- `plans/PAYMENTS_BLUEPRINT.md` - Obsolete planning document

## Bugs & Issues Encountered

1. **CSP blocking fetch to website**
   - **Symptom:** `Refused to connect to 'https://www.sonicflow.app/api/billing/portal'` error
   - **Root cause:** Content Security Policy `connect-src` didn't include the website domain
   - **Fix:** Added `"https://www.sonicflow.app"` to the connect array in `src/main.ts`

2. **Slow perceived responsiveness**
   - **Symptom:** 2-second delay in app before browser opened, button showing "..."
   - **Root cause:** App was waiting for API response before opening browser
   - **Fix:** Inverted the pattern - open browser immediately, let website handle the redirect

3. **Duplicate JSX closing tag**
   - **Symptom:** TypeScript errors after editing Button component
   - **Root cause:** Multi-replace left a duplicate `</Button>` tag
   - **Fix:** Cleaned up JSX structure manually

## Key Learnings

- **Perceived vs actual latency** - Moving API calls to a redirect page makes the app feel instant, even if total time is the same. Users expect browsers to load pages, but desktop apps should respond immediately.

- **Hash fragments for token passing** - Using `#token=...` instead of `?token=...` means the token isn't sent in HTTP request headers or logged on the server. Browser-side JS can still read it.

- **Industry pattern for billing portals** - Stripe, Dodo, and other payment providers all recommend server-side session creation + redirect. For desktop apps without cookies, passing the JWT to a redirect page is the standard approach.

- **CSP in Electron** - The Content Security Policy is set in `main.ts` during `onHeadersReceived`, not in HTML meta tags. Each domain the renderer needs to fetch from must be explicitly listed.

## Architecture Decisions

- **Redirect page vs fetch-then-open** - Chose redirect page for better UX. The tradeoff is an extra hop (app → website page → Dodo) but the perceived responsiveness is much better.

- **Token in hash vs query param** - Chose hash fragment for security (not logged), accepting that it requires client-side JavaScript to read. The existing website already handles this pattern for OAuth.

- **No loading state on Manage button** - Since the browser opens instantly, no loading indicator is needed. This keeps the UI clean and responsive.

## Ready for Next Session

- ✅ **App-side complete** - Manage button works with instant browser open
- ✅ **Website endpoint created** - Opus implemented `/api/billing/portal` POST endpoint
- ✅ **Redirect page created** - Opus implemented `/billing/portal` page that reads hash, calls API, redirects
- ✅ **Documentation updated** - PAYMENTS.md now includes Customer Portal section

## Context for Future

This completes the billing loop - users can now upgrade via the pricing page and manage their subscription via the Settings Panel. The pattern used here (instant browser open with token in hash → website redirect page) can be reused for any future features that need the app to trigger authenticated website actions (e.g., invoice history, plan changes). The cancellation flow is fully automatic via the existing webhook infrastructure - when a user cancels in Dodo's portal, the webhook sets `status = 'canceled'`, and the next JWT refresh will reflect `subscription_active: false`.
