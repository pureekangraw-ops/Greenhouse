# Unified Workplace: Greenhouse + personal planning

Status: prototype integration on a review branch. Not merged or deployed. HERMES local endpoint wiring is implemented but not yet device-verified; no cloud model, live Go, Hub, or owner-source connection is claimed.

## Product boundary

- Greenhouse remains the owner-workspace shell and read-only surface for authorized Work readbacks. The source Work System retains Work identity, lifecycle, and continuity.
- The `พื้นที่ส่วนตัว` route vendors the Factory District AI Universal Workplace interface from `yggmetro-group1/factory-district/imports/universal-workplace` as a personal planning/draft module for Puree, Go, and Saeng. The copy is reviewed into this Greenhouse branch; the repositories do not auto-sync, so future changes must be intentionally mirrored.
- Tasks, projects, activity, and manual handoff JSON in the personal module stay in browser `localStorage`. They do not create/update official Work, sync to Greenhouse/GO/Metropolis, or execute tools.
- The team view can call the HERMES OpenAI-compatible local endpoint (`http://localhost:8000/v1`) only after the user clicks the connection test. A typed prompt is sent only after the user presses Send; no task/project data is attached implicitly. Go/Saeng are prompt presets backed by the same HERMES model, not live agent connections. Replies are suggestions and never auto-update tasks.
- Handoff remains an explicit user-mediated file export/import and preview. A returned result is a proposal for the local draft only, not an Owner Source result.
- Greenhouse's official readback remains separate and read-only. No new login, command, runner, approval queue, or Work lifecycle path is added.

## Routes and security

- `/greenhouse/` is the Greenhouse shell.
- `/greenhouse/personal/` serves the local planner from the same origin, with an explicit local-only banner and a return link.
- The planner's JavaScript and CSS are external same-origin assets so `script-src 'self'` remains in force. Its small allowance for inline style attributes is scoped to the personal HTML route only; it does not allow inline scripts or arbitrary remote network connections.
- The planner does not call Greenhouse `/api/*` endpoints. It permits `connect-src` only to same-origin plus localhost/loopback and validates the endpoint host before sending. Sharing a host route is navigation integration, not data synchronization.
- HERMES reports loopback-only access; the Workplace page must be opened in a browser on the same phone. A desktop browser’s `localhost` refers to the desktop, not the phone. Auth is off in the provided HERMES status screenshot; do not expose this server to a LAN or public network.

## Verification boundary

Automated source-level checks verify route registration, local-only copy, external script/CSS loading, loopback-only endpoint validation, and the absence of implicit task transmission. These checks do not prove deployment, a successful request to the user’s HERMES device, model quality, live Hub readback, or assistant-to-assistant communication.
