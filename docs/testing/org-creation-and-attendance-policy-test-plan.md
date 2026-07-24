# Test Plan — Org Creation, Attendance Policy Wizard, Multi-Tenant Fixes

Manual QA checklist for everything built in this session: New Organization
(multi-step, admin-gated), the Attendance Policy wizard (Settings + New
Organization), forced password change for admin-created founders, the
Organizations console, and the org-directory/join lockdown.

Legend: `[ ]` not yet run · `[x]` pass · `[!]` fail (note what happened)

---

## A. Access control — who can even reach these screens

| # | Steps | Expected |
|---|---|---|
| A1 | Log in as `employee` or `manager`. Look at sidebar/bottom nav. | No "Organizations" nav item visible. |
| A2 | As `employee`/`manager`, navigate directly to `/organizations/new`. | Redirected to `/dashboard`. |
| A3 | As `employee`/`manager`, navigate directly to `/organizations`. | Redirected to `/dashboard`. |
| A4 | Log in as `admin`. Look at sidebar. | "Organizations" nav item visible. |
| A5 | As `admin`, click "Organizations" nav item. | Lands on `/organizations/new` directly (not the list). |
| A6 | As `admin`, navigate directly to `/organizations`. | Redirected to `/organizations/new` (not shown the list). |
| A7 | Log in as `super_admin`. Click "Organizations" nav item. | Lands on `/organizations` — the full list, with a "New Organization" button. |
| A8 | As `super_admin`, open `/organizations`. | Shows every org on the platform: name, plan badge, active/total user counts, created date. |
| A9 | Call `POST /api/auth/register` directly (e.g. via curl/Postman) with no auth session. | `401 Unauthorized`. |
| A10 | Call `POST /api/auth/register` while authenticated as `employee`/`manager`. | `403 Only admins can create a new organization`. |
| A11 | Call `GET /api/organizations` while authenticated as `admin` (not super_admin). | `403 Only super admins can view all organizations`. |

## B. New Organization — Administrator & Workspace stage

| # | Steps | Expected |
|---|---|---|
| B1 | Open New Organization. Leave all fields blank, click "Next". | Browser native validation blocks submit (all fields `required`). |
| B2 | Fill Full name, WhatsApp number, Email, Job title (dropdown), Company name, Company size, Workday start/end. Leave passwords blank. Click Next. | Blocked by `required` on password fields. |
| B3 | Enter mismatched Admin password / Confirm password. Click Next. | Inline error "Passwords do not match", stays on this stage. |
| B4 | Click the Job title dropdown. | Shows preset list (Software Engineer, HR Manager, Attorney, Physician, Store Manager, Administrator, …) plus **"Other (specify)…"** at the bottom. No **Department** field anywhere on this stage. |
| B5 | Select "Other (specify)…" under Job title, type a custom value (e.g. "Head of Ops"). | Switches to free-text input holding that value; a "Choose from list" link lets you go back to the dropdown. |
| B6 | Fill every field validly (password 8+ chars incl. upper/lower/number, matching confirm). Click "Next: Attendance policy". | Advances to the Attendance Policy stage. Nothing has been created in the DB yet. |

## C. New Organization — Attendance Policy stage (wizard branching)

Run once taking the **skip path**, once taking the **full fill-in path**.

### C1. Skip path
| # | Steps | Expected |
|---|---|---|
| C1.1 | On the Attendance Policy stage, click "Skip for now". | Jumps straight to Review stage, showing "Attendance policy skipped — the new admin can configure it later from Settings → Attendance Policy." |

### C2. Full fill-in path — branching checks
| # | Steps | Expected |
|---|---|---|
| C2.1 | Stage 1: select working days = "Rotational". | The "weekly offs" question disappears entirely. |
| C2.2 | Stage 1: switch working days back to "5". | Weekly-offs pills reappear. |
| C2.3 | Stage 1: select shift type = "Single shift". | No shift-list editor, no "shift assignment method" question shown. |
| C2.4 | Stage 1: select shift type = "Multiple fixed shifts". | Shift-list editor appears (pre-seeded with a second "Night" shift), plus "How does shift assignment work?" dropdown. |
| C2.5 | Stage 1: add/remove a shift row via the editor. | Rows add/remove correctly; can't remove the last remaining row. |
| C2.6 | Stage 2: select "Fixed-time shift". | Shows "Standard working hours" time range only. |
| C2.7 | Stage 2: select "Flexible hours". | Swaps to "Login window" time range instead. "How many hours count as a full day" always shown regardless. |
| C2.8 | Stage 3: toggle "Allow grace period" OFF. | Grace-minutes and late-allowed-per-month questions disappear. "What happens after the limit is exceeded" question stays visible either way. |
| C2.9 | Stage 3: toggle grace period back ON. | Both sub-questions reappear. |
| C2.10 | Stage 4: toggle "Track early leaving separately" ON. | "Early-leave threshold (minutes)" question appears. |
| C2.11 | Stage 4: toggle it OFF. | Threshold question disappears. |
| C2.12 | Stage 5: select capture method "Mobile app (GPS)". | Geo-fence location editor (name/lat/lng/radius) appears; add/remove a location works. |
| C2.13 | Stage 5: deselect GPS. | Geo-fence editor disappears. |
| C2.14 | Stage 5: toggle "Do field employees exist?" ON. | New follow-up appears: "Should field/remote employees follow a separate attendance policy?" |
| C2.15 | Stage 5: toggle field employees OFF. | The separate-policy follow-up disappears. |
| C2.16 | Stage 5: toggle "Need Work-From-Home as a separate category?" ON. | "WFH requires approval?" and "WFH counts toward attendance %?" toggles appear. |
| C2.17 | Stage 5: toggle WFH OFF. | Both sub-toggles disappear. |
| C2.18 | Stage 6: toggle "Track and compensate overtime?" ON. | "Overtime starts after…" hours input and "Requires pre-approval?" toggle appear. |
| C2.19 | Stage 6: toggle overtime OFF. | Sub-questions disappear. |
| C2.20 | Stage 7: toggle "Can employees request regularization?" OFF. | Monthly-limit and approver-role questions disappear. |
| C2.21 | Stage 7: toggle it back ON. | Sub-questions reappear. |
| C2.22 | Stage 8: add 2–3 holidays (date + name), toggle auto-sync on/off. | Rows persist across navigation within the wizard; can remove a row. |
| C2.23 | Stage 9: toggle "Should employees see their own dashboard?" OFF. | "What level of detail" question disappears. |
| C2.24 | Stage 9: toggle it ON. | "What level of detail should they see?" dropdown appears (Summary only / Detailed). |
| C2.25 | Use Back button from any stage. | Returns to the previous question stage without losing previously entered answers. |
| C2.26 | From Stage 1 of the attendance wizard, click Back. | Returns to the Administrator/Workspace stage (org fields still filled in as entered). |

## D. New Organization — Review & Create

| # | Steps | Expected |
|---|---|---|
| D1 | Reach Review after the full fill-in path (C2). | Shows Admin summary line (name, email, job title — no department), Workspace summary line, and a plain-English attendance summary paragraph that **mentions every answer given**, including: field-employee policy (if toggled), WFH, overtime, holiday count, and dashboard detail level. |
| D2 | Re-read the generated summary paragraph carefully. | Sentence content matches the actual selections made in C2 (spot check at least: working days/offs, shift or flexible hours, grace period, half-day threshold, capture method, escalation + dashboard detail). |
| D3 | Click Back from Review. | Returns to the last attendance-policy stage (Stage 9), answers intact. |
| D4 | Click "Create Organization" (full fill-in path). | Success banner: `Workspace "<name>" created…`. Form resets. `router.refresh()` fires (no crash). |
| D5 | Repeat D4 for the **skip path** org. | Same success banner; no attendance policy row should exist for this org (verify via Settings → Attendance Policy on that org showing the "never configured" first-run wizard, not a saved summary). |
| D6 | Try creating an org with a name that already exists. | Error: `A workspace named "<name>" already exists. Ask an admin there for an invite link instead of creating a new one.` No duplicate org created. |
| D7 | Try registering with an email that already has an account. | Error: `An account with this email already exists. Please sign in.` |

## E. Forced password change (admin-created founder)

| # | Steps | Expected |
|---|---|---|
| E1 | After D4/D5, sign in as the **new org's admin** using the password typed during creation. | Immediately redirected to `/change-password-required` — no dashboard content visible first. |
| E2 | On that screen, submit mismatched password/confirm. | Inline error, stays on screen. |
| E3 | Submit a valid new password (8+ chars, upper/lower/number). | Redirects to `/dashboard`. Sidebar/data loads normally. |
| E4 | Log out, log back in with the **new** password. | Succeeds, goes straight to `/dashboard` (no forced-change redirect this time). |
| E5 | Log out, try the **old** (creator-typed) password. | Login fails — password was actually changed in Supabase Auth, not just the flag cleared. |
| E6 | As an **existing** admin/employee (created before this feature, or via `/setup`), log in normally. | No redirect to `/change-password-required` — unaffected. |

## F. Settings → Attendance Policy (existing orgs)

| # | Steps | Expected |
|---|---|---|
| F1 | As admin of an org that has never configured attendance policy, open Settings → Attendance Policy. | Goes straight into the wizard (Stage 1), not a summary card. |
| F2 | Complete and save it. | Summary card replaces the wizard, showing the generated paragraph + "Edit attendance policy" button. |
| F3 | Click "Edit attendance policy". | Re-enters the wizard at Stage 1 with all previously saved answers pre-filled correctly (including the two new follow-ups if they were set). |
| F4 | Change one answer (e.g. grace minutes) and save again. | Summary card updates to reflect the new value. |
| F5 | As a non-admin role (employee/manager/hr), check whether "Attendance Policy" appears in the Settings section list. | Not visible — `requires: 'admin'` gate. |
| F6 | Reload the page mid-wizard (before saving). | Since nothing persists until save, reload loses in-progress answers and reloads from the last **saved** state (or blank wizard if never saved) — confirm this is the expected/acceptable behavior, not a crash. |

## G. Attendance enforcement (CHECK_IN / CHECK_OUT)

Requires an org with a **saved, `is_configured: true`** attendance policy.

| # | Steps | Expected |
|---|---|---|
| G1 | As an employee in a configured org, check in (WhatsApp or dashboard) **before** shift start + grace period. | Status recorded as `present`. |
| G2 | Check in **after** shift start + grace period (e.g. shift 09:00, grace 15 min → check in at 09:20). | Status recorded as `late`; reply includes a "(marked late — shift starts …)" note (WhatsApp) or equivalent. |
| G3 | Check out after working fewer hours than `half_day_threshold_hours`. | Status overrides to `half_day` regardless of whether G1/G2 set it to present/late; reply notes "(marked as a half-day today)" on WhatsApp. |
| G4 | Check out after working more than the half-day threshold. | Status stays whatever check-in set (present/late) — no override. |
| G5 | Repeat G1–G4 for an org that has **never** configured an attendance policy. | Status is always `present` at check-in regardless of time; no half-day override at checkout — i.e. unchanged legacy behavior. |
| G6 | Toggle "Is flexible hours" ON for an org's policy, save, then check in at any time. | Never marked `late` (no fixed start to be late against). |

## H. Reminders — per-org timezone & weekly-off (best-effort; cron-based, hard to test live)

| # | Steps | Expected |
|---|---|---|
| H1 | Set an org's attendance policy `weekly_offs` to something other than `['sat','sun']` (e.g. `['fri']` only) and save. | Manually trigger `POST /api/reminders/run` with `{"type":"checkin"}` (Bearer CRON_SECRET/APP_SECRET) on that weekday. | Reminders fire for that org (not skipped), since Friday isn't in its off-days list. |
| H2 | Manually trigger the same on an actual configured off-day for that org. | No check-in reminders sent for that org (but other orgs are unaffected). |
| H3 | For an org that has never configured attendance policy. | Falls back to the old default — skipped only on Sunday. |
| H4 | Confirm `organizations.settings.timezone` (set at org creation) affects which calendar date "today" resolves to for that org's attendance lookup. | Requires checking server logs / DB rows around a timezone boundary — flag as manual/best-effort verification, not easily automatable. |

## I. Org directory / join lockdown

| # | Steps | Expected |
|---|---|---|
| I1 | Visit `/join` with no token in the URL. | Error: "This link is invalid. Ask your admin or HR team for a fresh invite link." No organization picker/dropdown shown anywhere. |
| I2 | Call `GET /api/organizations/list` or `GET /api/organizations/info?id=...` directly. | `404` — routes no longer exist. |
| I3 | Generate a real invite link from an existing org's Team → Invite panel, open it in an incognito window. | Shows "You've been invited to join a workspace", org name banner, and the join form (with Department **required dropdown** — unlike New Organization, this one still has it). |
| I4 | Complete the join form via a valid invite link. | Successfully joins the correct org with the role baked into the token. |
| I5 | Tamper with the invite token (edit a character) and try to join. | Error: "Invite link is invalid or has expired." |
| I6 | Call `POST /api/auth/join` with an `orgId` but no `inviteToken`. | `422` validation error — `orgId`-only path no longer accepted. |

## J. Department/Job-title dropdown coverage sanity check

| # | Steps | Expected |
|---|---|---|
| J1 | Compare Department options shown on `/join` and in "Add team member" (CreateAccountModal) against the diversified list (Engineering/IT, Clinical/Medical, Legal/Compliance, Retail/Store Operations, etc.) | Both surfaces show the same expanded, industry-neutral list — not the old software-only list. |
| J2 | On both surfaces, select "Other (specify)…" for Department. | Swaps to free text as expected. |
| J3 | Confirm New Organization has **no Department field at all**, only Job title (dropdown). | Matches design decision — founding admin doesn't get asked department. |

---

## Out of scope for this test plan (known, deliberately deferred)

- Billing/plan enforcement (`organizations.plan` is still decorative).
- Org suspend/deactivate action on the Organizations console.
- Usage/message-volume metrics on the Organizations console.
- Reminders firing at the *correct local clock hour* for non-IST orgs (date/weekly-off correctness is fixed and covered in section H; clock-hour correctness needs a cron-frequency change that also affects task-deadline reminders — not done).
- `COMPLETE_TASK`/`ASSIGN_TASK` ownership gating and the HR Assistant permission contradiction (from the earlier RBAC audit) — explicitly on hold pending your RBAC document.
