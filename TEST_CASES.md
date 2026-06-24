# HRBot WhatsApp — Test Cases

> **How to use:** Send each "Input" message as the given role. Check that the bot output matches "Expected". Mark Pass ✅ / Fail ❌.
>
> **Roles:** `employee` = regular user | `admin` = manager/admin  
> **Types:** `text` = typed message | `audio` = voice note

---

## 1. Greetings

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| G-01 | employee | text | `hi` | Greeting card with menu (Tasks, Attendance, Leaves, Daily briefing, Team attendance) | |
| G-02 | employee | text | `hello` | Same greeting card | |
| G-03 | employee | text | `hey` | Same greeting card | |
| G-04 | employee | text | `Hi!` | Same greeting card | |
| G-05 | employee | text | `hii` | Same greeting card | |
| G-06 | employee | text | `good morning` | Same greeting card | |
| G-07 | employee | text | `Good Evening` | Same greeting card | |
| G-08 | employee | text | `namaste` | Same greeting card | |
| G-09 | employee | text | `hola` | Same greeting card | |
| G-10 | employee | text | `yo` | Same greeting card | |
| G-11 | admin | text | `hi` | Same greeting card (Team attendance shown as admin-only option) | |

---

## 2. Help

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| H-01 | employee | text | `help` | List of commands/features | |
| H-02 | employee | text | `what can you do` | Commands list or helpful reply | |
| H-03 | employee | text | `commands` | Commands list | |
| H-04 | employee | text | `how do I use this` | Helpful overview | |

---

## 3. Daily Briefing

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| DB-01 | employee | text | `daily briefing` | Today's tasks, attendance status, leave balance | |
| DB-02 | employee | text | `briefing` | Same as DB-01 | |
| DB-03 | employee | text | `what's my day look like` | Same as DB-01 | |
| DB-04 | employee | text | `show me today summary` | Same as DB-01 | |
| DB-05 | employee | text | `today` | Same as DB-01 | |
| DB-06 | admin | text | `daily briefing` | Same briefing (tasks = admin's own tasks) | |

---

## 4. Task Management — Listing

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TL-01 | employee | text | `list tasks` | Only own tasks, bullet points, dates as "24 Jun 2026" | |
| TL-02 | employee | text | `my tasks` | Same as TL-01 | |
| TL-03 | employee | text | `show tasks` | Same as TL-01 | |
| TL-04 | employee | text | `tasks` | Same as TL-01 | |
| TL-05 | employee | text | `what tasks do I have` | Same as TL-01 | |
| TL-06 | employee | text | `pending tasks` | Own tasks filtered by status (todo/in_progress) | |
| TL-07 | admin | text | `list all tasks` | ALL org tasks listed | |
| TL-08 | admin | text | `my tasks` | Only admin's own tasks | |
| TL-09 | admin | text | `tasks assigned to Tushar` | Only Tushar's tasks | |
| TL-10 | admin | text | `show Pranay's tasks` | Only Pranay's tasks | |
| TL-11 | employee | text | `list tasks` (no tasks exist) | "You have no tasks" or similar | |
| TL-12 | employee | text | `tasks with deadline today` | Tasks due today, formatted correctly | |
| TL-13 | employee | text | `urgent tasks` | Tasks with priority=urgent | |

---

## 5. Task Management — Creating

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TC-01 | employee | text | `create task Fix login bug` | Asks who to assign to (or defaults to self), then creates immediately | |
| TC-02 | employee | text | `create a task called Update docs assign to me` | Creates task with title "Update docs" assigned to self, no deadline | |
| TC-03 | admin | text | `create task Review reports assign to Tushar due tomorrow high priority` | Creates task: title, assignee=Tushar, deadline=tomorrow (YYYY-MM-DD), priority=high. NO time added. | |
| TC-04 | admin | text | `add task for Pranay: Prepare presentation` | Creates task for Pranay | |
| TC-05 | employee | text | `new task: Call client` | Creates task (self-assigned) | |
| TC-06 | employee | text | `create task` (no title) | Asks for task title | |
| TC-07 | admin | text | `create task XYZ assign to someone who doesn't exist` | Error: user not found | |
| TC-08 | employee | text | `create task ABC due next Friday` | Creates with deadline = next Friday, NO time component stored | |
| TC-09 | employee | text | `make a task urgent priority` | Asks for task title | |
| TC-10 | employee | text | `create task Quarterly review` (no assignee mentioned) | Asks who to assign to (or creates assigned to self after confirming) | |

### TC Audio Flow (voice-only)

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TC-A01 | employee | audio | "Create task Send report assign to me" | Confirmation message with task details + **Yes, do it / No, cancel** buttons | |
| TC-A02 | — | button | Tap **Yes, do it** (after TC-A01) | Task created, success reply | |
| TC-A03 | — | button | Tap **No, cancel** (after TC-A01) | "What would you like to change?" + field picker list (Title, Assignee, Deadline, Priority, Status) | |
| TC-A04 | — | button | Pick **Priority** from field list (after TC-A03) | Priority picker list (Low, Medium, High, Urgent) | |
| TC-A05 | — | button | Pick **High** from priority list (after TC-A04) | New confirmation with priority=High + Yes/No buttons | |
| TC-A06 | — | button | Tap **Yes, do it** (after TC-A05) | Task created with updated priority | |
| TC-A07 | — | button | Pick **Status** from field list | Status picker list (To Do, In Progress, Done, Cancelled) | |
| TC-A08 | admin | audio | "Create task Review budget assign to Tushar deadline 30 June urgent" | Confirmation: title, assignee=Tushar, deadline=30 Jun 2026 (no time), priority=urgent + Yes/No buttons | |

---

## 6. Task Management — Updating

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TU-01 | employee | text | `mark task Fix login bug as done` | Task status updated to done | |
| TU-02 | employee | text | `update task Fix login bug status to in progress` | Status updated | |
| TU-03 | employee | text | `change priority of Fix login bug to urgent` | Priority updated | |
| TU-04 | employee | text | `update deadline of Fix login bug to 30 Jun` | Deadline updated to 2026-06-30, no time component | |
| TU-05 | admin | text | `reassign Fix login bug to Pranay` | Assignee updated | |
| TU-06 | employee | text | `rename Fix login bug to Fix auth bug` | Title updated | |
| TU-07 | employee | text | `update task Fix login bug` (nothing else) | VAGUE UPDATE RULE: asks "What would you like to update?" with bullet list | |
| TU-08 | employee | text | `update the title` (no new title given) | MISSING VALUE RULE: asks "What should the new title be?" | |
| TU-09 | employee | text | `change the priority` (no value given) | MISSING VALUE RULE: asks what priority | |
| TU-10 | employee | text | `update the due time` (no new time given) | MISSING VALUE RULE: asks "What should the new deadline be?" | |
| TU-11 | employee | text | `update task that doesn't exist` | Error: task not found | |
| TU-12 | employee | text | `cancel the task Fix login bug` | Status set to cancelled | |
| TU-13 | employee | text | `done with Fix login bug` | Status set to done | |
| TU-14 | admin | text | `update all tasks to done` | Bot should handle each or clarify (no bulk update tool) | |
| TU-15 | employee | text | `update deadline of Fix login bug to tomorrow at 5pm` | Deadline set to tomorrow 17:00 (time included when user gave it) | |
| TU-16 | employee | text | `update deadline of Fix login bug to tomorrow` | Deadline set to tomorrow (date only, no time) | |

### TU Audio Flow

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TU-A01 | employee | audio | "Mark Fix login bug as done" | Confirmation: update task, status→done + Yes/No buttons | |
| TU-A02 | — | button | Tap **No, cancel** | "What would you like to change?" + field picker | |
| TU-A03 | — | button | Pick **Status** from field list | Status picker list | |
| TU-A04 | — | button | Pick **In Progress** | New confirmation with status=in_progress + Yes/No buttons | |
| TU-A05 | — | button | Tap **Yes, do it** | Task updated | |
| TU-A06 | employee | audio | "Update Fix login bug" (vague) | VAGUE UPDATE RULE: asks what to update with bullet options | |

---

## 7. Task Management — Deleting

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TD-01 | employee | text | `delete task Fix login bug` | Confirms deletion with warning: "⚠️ This cannot be undone" | |
| TD-02 | employee | audio | "Delete task Fix login bug" | Confirmation + Yes/No buttons | |
| TD-03 | — | button | Tap **Yes, do it** (after TD-02) | Task deleted | |
| TD-04 | — | button | Tap **No, cancel** (after TD-02) | Cancelled, task not deleted | |

---

## 8. Attendance — Check In / Out

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| AT-01 | employee | text | `check in` | Check-in recorded with time in IST | |
| AT-02 | employee | text | `I'm in` | Check-in recorded | |
| AT-03 | employee | text | `mark attendance` | Check-in recorded | |
| AT-04 | employee | text | `check in` (already checked in today) | Error: already checked in | |
| AT-05 | employee | text | `check out` | Check-out recorded with time in IST | |
| AT-06 | employee | text | `I'm leaving` | Check-out recorded | |
| AT-07 | employee | text | `checkout` | Check-out recorded | |
| AT-08 | employee | text | `check out` (not checked in) | Error: no check-in found | |
| AT-09 | employee | text | `my attendance` | This month's attendance log with IST times | |
| AT-10 | employee | text | `attendance history` | Same as AT-09 | |
| AT-11 | employee | text | `show my attendance` | Same as AT-09 | |

---

## 9. Team Attendance (Admin Only)

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| TA-01 | admin | text | `team attendance` | Today's attendance for all team members with IST check-in/out times | |
| TA-02 | admin | text | `who checked in today` | Same as TA-01 | |
| TA-03 | admin | text | `show attendance of team` | Same as TA-01 | |
| TA-04 | employee | text | `team attendance` | Access denied (not admin) | |
| TA-05 | employee | text | `who is in office today` | Access denied OR no data shown | |

---

## 10. Leave Management — Employee

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| LV-01 | employee | text | `leave balance` | Remaining leave count by type | |
| LV-02 | employee | text | `how many leaves do I have` | Same as LV-01 | |
| LV-03 | employee | text | `my leaves` | List of own leave requests | |
| LV-04 | employee | text | `apply leave` | Asks for type, dates, reason | |
| LV-05 | employee | text | `apply sick leave from 25 Jun to 27 Jun reason fever` | Submits leave request | |
| LV-06 | employee | text | `apply casual leave for tomorrow` | Asks for reason (if required) then submits | |
| LV-07 | employee | text | `apply leave from 20 Jun to 18 Jun` (end before start) | Error: invalid date range | |
| LV-08 | employee | text | `I want to take a day off tomorrow` | Bot asks for leave type and reason, then submits | |
| LV-09 | employee | text | `show my leave history` | Same as LV-03 | |

---

## 11. Leave Management — Admin

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| LA-01 | admin | text | `pending leaves` | List of all pending leave requests | |
| LA-02 | admin | text | `show leave requests` | Same as LA-01 | |
| LA-03 | admin | text | `approve leave for Tushar` | Confirms approval, then approves | |
| LA-04 | admin | audio | "Approve leave for Pranay" | Confirmation + Yes/No buttons | |
| LA-05 | — | button | Tap **Yes, do it** (after LA-04) | Leave approved, Pranay notified | |
| LA-06 | admin | text | `reject leave for Tushar reason not enough notice` | Rejects with reason | |
| LA-07 | employee | text | `approve leave for Tushar` | Access denied (not admin) | |
| LA-08 | admin | text | `pending leaves` (no requests) | "No pending leave requests" | |

---

## 12. Natural Language Variations (Typos / Informal)

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| NL-01 | employee | text | `lst my tasks` | Lists tasks (handles typo) | |
| NL-02 | employee | text | `create taks Report` | Creates task "Report" | |
| NL-03 | employee | text | `chek in` | Check-in recorded | |
| NL-04 | employee | text | `leav balance` | Shows leave balance | |
| NL-05 | employee | text | `wat r my tasks` | Lists tasks | |
| NL-06 | employee | text | `task done for fix login bug` | Status updated to done | |
| NL-07 | employee | text | `update fix login bug to high priority` | Priority updated to high | |
| NL-08 | employee | text | `fix login bug done` | Status updated to done | |
| NL-09 | employee | text | `need to take leave tmrw` | Asks for leave type and reason | |
| NL-10 | employee | text | `add task - Write test cases - assign to me - urgent` | Creates task with priority=urgent | |
| NL-11 | employee | text | `kya tasks hain mere` (Hindi) | Lists own tasks | |
| NL-12 | employee | text | `check in kar diya` (Hindi/English mix) | Check-in recorded | |
| NL-13 | employee | text | `chutti chahiye kal` (Hindi for "I want leave tomorrow") | Asks for leave type and submits | |
| NL-14 | employee | text | `task complete` (no task name) | Asks which task | |
| NL-15 | employee | text | `done` (after context of updating a task) | Bot should understand from context what to mark done | |

---

## 13. Multi-Field / Complex Requests

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| MF-01 | admin | text | `create task Prepare deck assign to Pranay due 30 Jun high priority` | Task created: title=Prepare deck, assignee=Pranay, deadline=2026-06-30 (no time), priority=high | |
| MF-02 | employee | text | `update Fix login bug: set status to done and priority to low` | Both status and priority updated in one call | |
| MF-03 | employee | text | `check in and show my tasks` | Check-in recorded, then tasks listed | |
| MF-04 | employee | text | `apply leave for 3 days from tomorrow sick leave reason not feeling well` | Leave submitted | |
| MF-05 | admin | text | `list pending leaves and approve the one for Tushar` | Lists pending leaves, then asks confirmation before approving | |

---

## 14. Edge Cases & Boundary Conditions

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| EC-01 | employee | text | (empty / blank message) | Asks user to type a message or shows help | |
| EC-02 | employee | text | `...` | Asks user what they need | |
| EC-03 | employee | text | `123456` | Asks what the user needs | |
| EC-04 | employee | text | `https://somelink.com` | Does not follow link; asks what user needs | |
| EC-05 | employee | text | `create task for tomorrow` (no title) | Asks for task title | |
| EC-06 | employee | text | `update that task` (no task name, no prior context) | Asks which task | |
| EC-07 | employee | text | `delete all my tasks` | No bulk delete tool — clarifies or asks per task | |
| EC-08 | employee | text | (very long message, 500+ chars) | Bot processes the key intent, responds normally | |
| EC-09 | employee | text | `create task` repeated 5 times | Each creates a new task OR asks for title | |
| EC-10 | employee | text | `update Fix login bug deadline to 25-06-2026 18:30` | If user gave time explicitly → stores with time. Formatted in list as "at 06:30 PM" | |
| EC-11 | employee | text | `create task Test with deadline 26 Jun` | Deadline stored as 2026-06-26 (date only, no time invented) | |
| EC-12 | employee | text | `who am I` | Bot shows user name and role | |
| EC-13 | employee | audio | (audio with background noise / unclear) | Bot transcribes best-effort and responds or asks to repeat | |

---

## 15. Access Control

| ID | Role | Type | Input | Expected Output | P/F |
|----|------|------|-------|-----------------|-----|
| AC-01 | employee | text | `team attendance` | Denied — not admin | |
| AC-02 | employee | text | `list pending leaves` | Denied — not admin | |
| AC-03 | employee | text | `approve leave` | Denied — not admin | |
| AC-04 | employee | text | `show all tasks` | Shows own tasks only (not all org tasks) | |
| AC-05 | admin | text | `my tasks` | Shows admin's own tasks (not all org tasks) | |
| AC-06 | admin | text | `tasks assigned to Tushar` | Shows Tushar's tasks | |
| AC-07 | admin | text | `all tasks` | Shows all org tasks | |

---

## 16. Confirmation Flow (Audio — Full Loop)

> Complete end-to-end flows that must work without regression.

### Flow A: Voice create → Yes
1. Audio: "Create task Design mockup assign to me high priority" → **Confirm?** card with Yes/No buttons  
2. Tap **Yes, do it** → Task created, no deadline stored

### Flow B: Voice create → No → Change Priority → Confirm → Yes
1. Audio: "Create task Design mockup" → Confirm card
2. Tap **No, cancel** → Field picker list (Title, Assignee, Deadline, Priority, Status)
3. Tap **Priority** → Priority picker (Low, Medium, High, Urgent)
4. Tap **Urgent** → New confirm card with priority=Urgent
5. Tap **Yes, do it** → Task created with urgent priority

### Flow C: Voice update → No → Change Status → Confirm → No → Change Title → Confirm → Yes
1. Audio: "Mark Fix login bug as done" → Confirm card
2. Tap **No, cancel** → Field picker
3. Tap **Status** → Status picker
4. Tap **In Progress** → New confirm card with status=in_progress
5. Tap **No, cancel** → Field picker again
6. Tap **Title** → "What should the new title be? Please type it."
7. Type: "Fix auth bug" → Confirm card with new title
8. Tap **Yes, do it** → Task updated with new title

### Flow D: Text input — NO confirmation shown
1. Text: "Create task Design mockup" → Task created immediately (no confirmation for text)

### Flow E: Voice delete → Confirm → Yes
1. Audio: "Delete task Fix login bug" → Confirm card with ⚠️ warning
2. Tap **Yes, do it** → Task deleted

---

## 17. Date / Time Formatting (Critical)

| ID | Scenario | Input | Expected Stored | Expected Display | P/F |
|----|----------|-------|-----------------|------------------|-----|
| DT-01 | Date only | `due 30 Jun` | `2026-06-30` | "30 Jun 2026" | |
| DT-02 | Date + time (user gave time) | `due tomorrow at 5pm` | `2026-06-25T17:00:00` | "25 Jun 2026 at 05:00 PM" | |
| DT-03 | Date only in ISO | `due 2026-07-01` | `2026-07-01` | "01 Jul 2026" | |
| DT-04 | Relative: next Monday | `next Monday` | Correct YYYY-MM-DD | Formatted date | |
| DT-05 | No date given | (nothing) | `null` | Not shown in list | |
| DT-06 | Relative: end of month | `end of month` | Last day of month | Formatted date | |
| DT-07 | Attendance times | check-in recorded | Stored as UTC | Display as IST e.g. "02:47 PM IST" | |
| DT-08 | NEVER invent time | Create task with date only | No `T...` part stored | No "at HH:MM" in display | |

---

## 18. Reply Format Checks

| ID | Check | Expected | P/F |
|----|-------|----------|-----|
| RF-01 | Task list format | Bullet points `•`, date as "24 Jun 2026", time as "at 06:29 PM" if set | |
| RF-02 | No YYYY-MM-DD in any reply | Dates always human-readable | |
| RF-03 | WhatsApp bold | Key terms wrapped in `*bold*` | |
| RF-04 | Confirmation card | Shows all relevant fields, ends with Yes/No buttons (not text) | |
| RF-05 | Field picker | Shows as WhatsApp list (tap to open), not plain text | |
| RF-06 | Priority picker | WhatsApp list with emoji: 🟢 Low, 🟡 Medium, 🟠 High, 🔴 Urgent | |
| RF-07 | Status picker | WhatsApp list with emoji: 📋 To Do, ⏳ In Progress, ✅ Done, ❌ Cancelled | |
| RF-08 | No JSON leakage | LLM output never shows raw JSON or `{"function_calls":...}` | |
| RF-09 | No tool-call leak | LLM never exposes tool call syntax in plain text | |
| RF-10 | Error messages | Friendly, not stack traces or raw API errors | |

---

## 19. Regression (Previously Fixed Bugs)

| ID | Bug | Test Input | Must NOT happen | P/F |
|----|-----|-----------|-----------------|-----|
| RG-01 | Bot invented deadline time | `create task ABC due 30 Jun` | Stored as `2026-06-30` (no `T18:29:00` appended) | |
| RG-02 | "update due time" → bot repeats same time | `update testing task 1 due time` | Bot asks "What should the new deadline be?" instead of silently updating | |
| RG-03 | Admin denied team attendance | (as admin) `team attendance` | Attendance shown, NOT "you can only see your own attendance" | |
| RG-04 | Team attendance shows wrong times | (as admin) `team attendance` | Actual IST check-in/check-out times, not hallucinated ones | |
| RG-05 | Audio task created without confirmation | (voice) "Create task XYZ" | Confirmation card shown FIRST, task NOT created immediately | |
| RG-06 | Confirmation shows text buttons only | (voice) any CRUD → confirm | Actual WhatsApp interactive buttons (not plain text "1. Yes 2. No") | |
| RG-07 | LLM tool call leaked as markdown | Any complex request | No ` ```json ` blocks or `{"name":"create_task",...}` in reply | |

---

*Generated: 24 Jun 2026 | Coverage: 15 tools × employee + admin × text + audio + interactive*
