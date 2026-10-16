# Unified Workplace: Greenhouse + personal planning

Status: prototype integration on a review branch. Not merged or deployed. No live model, Go, Hub, or owner-source connection is claimed.

## Product boundary

- Greenhouse remains the owner-workspace shell and read-only surface for authorized Work readbacks. The source Work System retains Work identity, lifecycle, and continuity.
- The `พื้นที่ส่วนตัว` route vendors the Factory District AI Universal Workplace interface from `yggmetro-group1/factory-district/imports/universal-workplace` as a personal planning/draft module for Puree, Go, and Saeng. The copy is reviewed into this Greenhouse branch; the repositories do not auto-sync, so future changes must be intentionally mirrored.
- Tasks, projects, activity, and manual handoff JSON in the personal module stay in browser `localStorage`. They do not create/update official Work, sync to Greenhouse/GO/Metropolis, or execute tools.
- Handoff remains an explicit user-mediated file export/import and preview. A returned result is a proposal for the local draft only, not an Owner Source result.
- Greenhouse's official readback remains separate and read-only. No new login, command, runner, approval queue, or Work lifecycle path is added.

## Routes and security

- `/greenhouse/` is the Greenhouse shell.
- `/greenhouse/personal/` serves the local planner from the same origin, with an explicit local-only banner and a return link.
- The planner's JavaScript and CSS are external same-origin assets so `script-src 'self'` remains in force. Its small allowance for inline style attributes is scoped to the personal HTML route only; it does not allow inline scripts or external network connections.
- The planner does not call Greenhouse `/api/*` endpoints. Sharing a host route is navigation integration, not data synchronization.

## Verification boundary

Automated source-level checks verify route registration, local-only copy, external script/CSS loading, and the absence of network/API calls in the planner. These checks do not prove deployment, live Hub readback, model behavior, or assistant-to-assistant communication.
