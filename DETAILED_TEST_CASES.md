# HRBot WhatsApp — Detailed Test Cases

**Version:** 1.0  
**Date:** 24 Jun 2026  
**Bot URL:** https://whatsapp-hrbot.vercel.app  

---

## How to Run Tests

1. Send the **Input** message from a WhatsApp number registered as the given **Role**
2. Compare the actual bot reply with **Expected Output**
3. Mark **P** (Pass) or **F** (Fail) in the result column
4. For multi-step flows, each step must pass before moving to the next

### Legend
- `[TEXT]` = plain WhatsApp text message
- `[AUDIO]` = voice note
- `[BTN]` = interactive quick-reply button tap
- `[LIST]` = interactive list item selection
- `*bold*` = WhatsApp bold formatting
- `• item` = bullet point
- `[BUTTONS: A | B]` = WhatsApp interactive buttons rendered (not text)
- `[LIST: label → items]` = WhatsApp list picker rendered

---

## Pre-conditions Required Before Testing

Before running any test, ensure the following data exists in Supabase:

| Data | Required For |
|------|-------------|
| Employee user with role=`employee` | All employee tests |
| Admin user with role=`admin` | All admin tests |
| At least 2 tasks assigned to employee | Task listing/update tests |
| At least 1 task assigned to admin (different from above) | Admin "my tasks" test |
| Today's check-in NOT yet done | Check-in tests (AT-01 to AT-03) |
| Today's check-in already done | Already-checked-in test (AT-04) |
| At least 1 pending leave request | Admin leave approval tests |

---

## SECTION 1 — GREETINGS

---

### TC-G-001
**Title:** Simple "hi" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `hi`  
**Pre-condition:** Any registered employee  

**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
Hello [FirstName]! I am *HRBot*, your AI HR assistant.

*What I can help you with:*
- *Tasks* - list, create, update tasks
- *Attendance* - check in/out, history
- *Leaves* - balance, apply leave
- *Daily briefing* - today summary
- *Team attendance* - admin only

What would you like to do?
```
**Pass/Fail:** ___

---

### TC-G-002
**Title:** "hello" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `hello`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-003
**Title:** "hii" (double i typo)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `hii`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-004
**Title:** "hey" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `hey`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-005
**Title:** "Good morning" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `Good morning`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-006
**Title:** "Good evening" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `Good Evening`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-007
**Title:** "namaste" greeting  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `namaste`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-008
**Title:** Greeting with punctuation  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `hi!`  
**Expected Output:** Same as TC-G-001  
**Pass/Fail:** ___

---

### TC-G-009
**Title:** Admin greeting shows same menu  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `hi`  
**Expected Output:** Same as TC-G-001 (bot shows same greeting for all roles)  
**Pass/Fail:** ___

---

## SECTION 2 — HELP

---

### TC-H-001
**Title:** Help command  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `help`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** A list of supported commands/features covering tasks, attendance, leaves, briefing  
**Must NOT contain:** Raw JSON, tool names like `list_tasks`, error messages  
**Pass/Fail:** ___

---

### TC-H-002
**Title:** "what can you do"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `what can you do`  
**Expected Output:** Overview of bot capabilities (same as help)  
**Pass/Fail:** ___

---

### TC-H-003
**Title:** "how do I use this"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `how do I use this`  
**Expected Output:** Helpful overview of features  
**Pass/Fail:** ___

---

## SECTION 3 — DAILY BRIEFING

---

### TC-DB-001
**Title:** Daily briefing — standard  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `daily briefing`  
**Pre-condition:** Employee has at least 1 task; has or hasn't checked in today  
**Expected Response Type:** `[TEXT]`  
**Expected Output must include:**
- Today's date
- Employee's pending tasks (count or list)
- Today's check-in status (checked in / not checked in)
- Leave balance summary
**Format:** Bullet points, dates as "24 Jun 2026" (NOT YYYY-MM-DD)  
**Pass/Fail:** ___

---

### TC-DB-002
**Title:** "briefing" shorthand  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `briefing`  
**Expected Output:** Same as TC-DB-001  
**Pass/Fail:** ___

---

### TC-DB-003
**Title:** "what's my day look like"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `what's my day look like`  
**Expected Output:** Same as TC-DB-001  
**Pass/Fail:** ___

---

### TC-DB-004
**Title:** "today" shorthand  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `today`  
**Expected Output:** Same as TC-DB-001  
**Pass/Fail:** ___

---

## SECTION 4 — TASK LISTING

---

### TC-TL-001
**Title:** Employee lists own tasks  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `list tasks`  
**Pre-condition:** Employee has 2+ tasks in DB  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
Here are your tasks:
• [Task Title 1] - due [DD Mon YYYY] - [priority] - [status] - assigned to [Name]
• [Task Title 2] - due [DD Mon YYYY] - [priority] - [status] - assigned to [Name]
```
**Must NOT contain:**
- Tasks belonging to other users
- Dates in `YYYY-MM-DD` format
- Time like "at HH:MM" unless a deadline time was explicitly set
**Pass/Fail:** ___

---

### TC-TL-002
**Title:** "my tasks" shorthand  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `my tasks`  
**Expected Output:** Same as TC-TL-001  
**Pass/Fail:** ___

---

### TC-TL-003
**Title:** "show tasks"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `show tasks`  
**Expected Output:** Same as TC-TL-001  
**Pass/Fail:** ___

---

### TC-TL-004
**Title:** "what tasks do I have"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `what tasks do I have`  
**Expected Output:** Same as TC-TL-001  
**Pass/Fail:** ___

---

### TC-TL-005
**Title:** No tasks exist  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `list tasks`  
**Pre-condition:** Employee has zero tasks in DB  
**Expected Output:** Something like "You have no tasks." or "No tasks found."  
**Must NOT contain:** An empty bullet list or error stack trace  
**Pass/Fail:** ___

---

### TC-TL-006
**Title:** Admin lists ALL org tasks  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `list all tasks`  
**Pre-condition:** Multiple employees have tasks  
**Expected Output:** All tasks across all employees in the organisation  
**Pass/Fail:** ___

---

### TC-TL-007
**Title:** Admin views own tasks only  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `my tasks`  
**Expected Output:** Only admin's own tasks (not all org tasks)  
**Pass/Fail:** ___

---

### TC-TL-008
**Title:** Admin filters by employee name  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `tasks assigned to Tushar`  
**Pre-condition:** User "Tushar" exists and has tasks  
**Expected Output:** Only Tushar's tasks  
**Pass/Fail:** ___

---

### TC-TL-009
**Title:** Admin filters by employee (possessive)  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `show Pranay's tasks`  
**Expected Output:** Only Pranay's tasks  
**Pass/Fail:** ___

---

### TC-TL-010
**Title:** Employee tries to view another person's tasks  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `show Tushar's tasks`  
**Expected Output:** Access denied message, e.g. "🚫 You don't have permission to view other people's tasks."  
**Pass/Fail:** ___

---

## SECTION 5 — TASK CREATION (TEXT)

---

### TC-TC-001
**Title:** Create task — all fields in one message  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `create task Fix login bug assign to Tushar due 30 Jun high priority`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** Task created confirmation, e.g.:
```
✅ Task *Fix login bug* created!
• Assignee: Tushar
• Deadline: 30 Jun 2026
• Priority: high
```
**Must NOT contain:**
- Any time like "at 06:29 PM" (no time was given)
- Dates in YYYY-MM-DD format
**Pass/Fail:** ___

---

### TC-TC-002
**Title:** Create task — no deadline, no priority  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Update documentation`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** Bot asks who to assign to (or creates assigned to self). Then creates:
```
✅ Task *Update documentation* created!
• Assignee: [Current user]
• Priority: medium (default)
```
**Must NOT contain:** Any invented deadline  
**Pass/Fail:** ___

---

### TC-TC-003
**Title:** Create task — only title given  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task`  
**Expected Output:** Bot asks: "What should the task title be?"  
**Pass/Fail:** ___

---

### TC-TC-004
**Title:** Create task — relative date "tomorrow"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Call client deadline tomorrow`  
**Expected Output:** Task created with deadline = tomorrow's date (DD Mon YYYY), no time stored  
**Pass/Fail:** ___

---

### TC-TC-005
**Title:** Create task — "next Friday"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Submit report due next Friday`  
**Expected Output:** Task created with deadline = next Friday's date  
**Pass/Fail:** ___

---

### TC-TC-006
**Title:** Create task — unknown assignee  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `create task Review plan assign to John Doe`  
**Pre-condition:** "John Doe" does not exist in the organisation  
**Expected Output:** Error — user not found in this organisation  
**Pass/Fail:** ___

---

### TC-TC-007
**Title:** Create task — urgent priority  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `add task Deploy hotfix urgent`  
**Expected Output:** Task created with priority=urgent  
**Pass/Fail:** ___

---

### TC-TC-008
**Title:** Create task — informal phrasing  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `new task: Prepare presentation`  
**Expected Output:** Task created with title "Prepare presentation"  
**Pass/Fail:** ___

---

### TC-TC-009
**Title:** Create task — no duplicate by title  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Fix login bug` (task with this title already exists)  
**Expected Output:** Task still created (bot does not block duplicates); OR bot warns a task with this name exists and asks to confirm  
**Pass/Fail:** ___

---

### TC-TC-010
**Title:** CRITICAL — No invented deadline  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Test deployment`  
**Expected Output:** Task created with NO deadline field in the reply. When user lists tasks after, no date appears for this task.  
**Must NOT contain:** Any date or time in the task creation response if no date was given  
**Pass/Fail:** ___

---

## SECTION 6 — TASK CREATION (AUDIO CONFIRMATION FLOW)

---

### TC-AUD-001
**Title:** Audio create → shows confirmation with buttons  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Create task Send weekly report assign to me"  
**Expected Response Type:** `[TEXT + BUTTONS]`  
**Expected Output:**
```
Please confirm:

• Title: *Send weekly report*
• Assignee: *[Employee Name]*
• Priority: *medium*

Confirm?
```
`[BUTTONS: Yes, do it | No, cancel]`  
**Must NOT:** Create the task immediately — task must NOT exist in DB yet  
**Pass/Fail:** ___

---

### TC-AUD-002
**Title:** Audio create → tap YES → task created  
**Role:** Employee  
**Type:** `[BTN]`  
**Pre-condition:** TC-AUD-001 was just sent  
**Input:** Tap **"Yes, do it"** button  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** Task created confirmation:
```
✅ Task *Send weekly report* created!
• Assignee: [Name]
• Priority: medium
```
**Verify:** Task now exists in Supabase DB  
**Pass/Fail:** ___

---

### TC-AUD-003
**Title:** Audio create → tap NO → shows field picker  
**Role:** Employee  
**Type:** `[BTN]`  
**Pre-condition:** TC-AUD-001 was just sent  
**Input:** Tap **"No, cancel"** button  
**Expected Response Type:** `[TEXT + LIST]`  
**Expected Output:**
```
What would you like to change?
```
`[LIST: "Choose field" → Title | Assignee | Deadline | Priority | Status]`  
**Must NOT:** Create or cancel the task  
**Pass/Fail:** ___

---

### TC-AUD-004
**Title:** Field picker → choose Priority  
**Role:** Employee  
**Type:** `[LIST]`  
**Pre-condition:** TC-AUD-003 field list is showing  
**Input:** Select **"Priority"** from the list  
**Expected Response Type:** `[TEXT + LIST]`  
**Expected Output:**
```
Choose the priority:
```
`[LIST: "Choose priority" → 🟢 Low | 🟡 Medium | 🟠 High | 🔴 Urgent]`  
**Pass/Fail:** ___

---

### TC-AUD-005
**Title:** Priority picker → choose Urgent → new confirmation  
**Role:** Employee  
**Type:** `[LIST]`  
**Pre-condition:** TC-AUD-004 priority list is showing  
**Input:** Select **"🔴 Urgent"** from the list  
**Expected Response Type:** `[TEXT + BUTTONS]`  
**Expected Output:**
```
Please confirm:

• Title: *Send weekly report*
• Assignee: *[Name]*
• Priority: *urgent*

Confirm?
```
`[BUTTONS: Yes, do it | No, cancel]`  
**Pass/Fail:** ___

---

### TC-AUD-006
**Title:** Updated confirmation → tap YES → task created with urgent priority  
**Role:** Employee  
**Type:** `[BTN]`  
**Pre-condition:** TC-AUD-005 was just shown  
**Input:** Tap **"Yes, do it"**  
**Expected Output:** Task created with priority=urgent  
**Verify:** Task in DB has `priority = 'urgent'`  
**Pass/Fail:** ___

---

### TC-AUD-007
**Title:** Field picker → choose Status  
**Role:** Employee  
**Type:** `[LIST]`  
**Pre-condition:** Field picker is showing (after tap No)  
**Input:** Select **"Status"** from the list  
**Expected Response Type:** `[TEXT + LIST]`  
**Expected Output:**
```
Choose the status:
```
`[LIST: "Choose status" → 📋 To Do | ⏳ In Progress | ✅ Done | ❌ Cancelled]`  
**Pass/Fail:** ___

---

### TC-AUD-008
**Title:** Field picker → choose Deadline  
**Type:** `[LIST]`  
**Input:** Select **"Deadline"** from the list  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
📅 What should the new deadline be? (e.g. "tomorrow", "25 Jun 2026")
```
**Pass/Fail:** ___

---

### TC-AUD-009
**Title:** Field picker → choose Title  
**Type:** `[LIST]`  
**Input:** Select **"Title"** from the list  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
✏️ What should the new title be? Please type it.
```
**Pass/Fail:** ___

---

### TC-AUD-010
**Title:** Field picker → choose Assignee  
**Type:** `[LIST]`  
**Input:** Select **"Assignee"** from the list  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
👤 Who should this be assigned to? Please type their name.
```
**Pass/Fail:** ___

---

### TC-AUD-011
**Title:** Text message — NO confirmation shown  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Test ABC assign to me`  
**Expected Output:** Task created IMMEDIATELY (no confirmation card for text input)  
**Must NOT show:** Yes/No buttons for a text message  
**Pass/Fail:** ___

---

### TC-AUD-012
**Title:** Audio — delete task → shows confirmation  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Delete task Fix login bug"  
**Expected Response Type:** `[TEXT + BUTTONS]`  
**Expected Output:**
```
Please confirm:

DELETE task: *Fix login bug*
⚠️ This cannot be undone.

Confirm?
```
`[BUTTONS: Yes, do it | No, cancel]`  
**Pass/Fail:** ___

---

### TC-AUD-013
**Title:** Delete confirmation → YES → task soft-deleted  
**Type:** `[BTN]`  
**Pre-condition:** TC-AUD-012 shown  
**Input:** Tap **"Yes, do it"**  
**Expected Output:** "Task deleted successfully." or similar  
**Verify:** Task has `deleted_at` set in Supabase  
**Pass/Fail:** ___

---

### TC-AUD-014
**Title:** Delete confirmation → NO → task not deleted  
**Type:** `[BTN]`  
**Pre-condition:** TC-AUD-012 shown  
**Input:** Tap **"No, cancel"**  
**Expected Output:** Cancelled, task NOT deleted. Shows field picker ("What would you like to change?")  
**Pass/Fail:** ___

---

## SECTION 7 — TASK UPDATING (TEXT)

---

### TC-TU-001
**Title:** Mark task as done  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `mark Fix login bug as done`  
**Pre-condition:** Task "Fix login bug" assigned to employee  
**Expected Output:** 
```
✅ Task *Fix login bug* updated!
• Status: done
```
**Pass/Fail:** ___

---

### TC-TU-002
**Title:** Change status to in_progress  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update task Fix login bug status to in progress`  
**Expected Output:** Task status updated to in_progress  
**Pass/Fail:** ___

---

### TC-TU-003
**Title:** Change priority  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `change priority of Fix login bug to urgent`  
**Expected Output:** Task priority updated to urgent  
**Pass/Fail:** ___

---

### TC-TU-004
**Title:** Update deadline — date only (no time)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update deadline of Fix login bug to 30 Jun`  
**Expected Output:** Deadline updated to "30 Jun 2026"  
**Must NOT:** Store any time component — deadline must be date-only  
**Pass/Fail:** ___

---

### TC-TU-005
**Title:** Update deadline — with explicit time  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update deadline of Fix login bug to 30 Jun at 5pm`  
**Expected Output:** Deadline updated to "30 Jun 2026 at 05:00 PM"  
**Pass/Fail:** ___

---

### TC-TU-006
**Title:** Reassign task (admin only)  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `reassign Fix login bug to Pranay`  
**Expected Output:** Task assignee changed to Pranay  
**Pass/Fail:** ___

---

### TC-TU-007
**Title:** Employee tries to reassign another person's task  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `reassign Fix login bug to Pranay`  
**Pre-condition:** Task belongs to admin, not this employee  
**Expected Output:** Error — task not found (employee can't see others' tasks) OR access denied  
**Pass/Fail:** ___

---

### TC-TU-008
**Title:** Rename task  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `rename Fix login bug to Fix auth bug`  
**Expected Output:** Task title updated to "Fix auth bug"  
**Pass/Fail:** ___

---

### TC-TU-009
**Title:** VAGUE UPDATE — no field specified  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update task Fix login bug`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
What would you like to update?
• Title
• Assignee
• Deadline
• Priority
• Status
```
**Must NOT:** Call update_task with no changes  
**Pass/Fail:** ___

---

### TC-TU-010
**Title:** MISSING VALUE — field named but no new value (title)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update the title`  
**Expected Output:** Bot asks: "What should the new title be?" (does NOT update to nothing)  
**Pass/Fail:** ___

---

### TC-TU-011
**Title:** MISSING VALUE — field named but no new value (priority)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `change the priority of Fix login bug`  
**Expected Output:** Bot asks what priority to set (Low/Medium/High/Urgent), does NOT guess  
**Pass/Fail:** ___

---

### TC-TU-012
**Title:** MISSING VALUE — due time without new value  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update testing task 1 due time`  
**Expected Output:** Bot asks: "What should the new deadline be?"  
**Must NOT:** Set deadline to current clock time or repeat existing deadline  
**Pass/Fail:** ___

---

### TC-TU-013
**Title:** Task not found  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update task NonExistentTask123 as done`  
**Expected Output:** "Task 'NonExistentTask123' not found."  
**Pass/Fail:** ___

---

### TC-TU-014
**Title:** Cancel a task  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `cancel the task Fix login bug`  
**Expected Output:** Task status updated to cancelled  
**Pass/Fail:** ___

---

### TC-TU-015
**Title:** Mark done — casual phrasing  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `done with Fix login bug`  
**Expected Output:** Task status updated to done  
**Pass/Fail:** ___

---

## SECTION 8 — TASK UPDATING (AUDIO FLOW)

---

### TC-AU-001
**Title:** Audio update → shows confirmation  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Mark Fix login bug as done"  
**Expected Response Type:** `[TEXT + BUTTONS]`  
**Expected Output:**
```
Please confirm:

Task: *Fix login bug*
• Status → done

Confirm?
```
`[BUTTONS: Yes, do it | No, cancel]`  
**Must NOT:** Update task immediately  
**Pass/Fail:** ___

---

### TC-AU-002
**Title:** Audio update → YES → updated  
**Type:** `[BTN]`  
**Pre-condition:** TC-AU-001 shown  
**Input:** Tap **"Yes, do it"**  
**Expected Output:** Task status updated to done  
**Pass/Fail:** ___

---

### TC-AU-003
**Title:** Audio update → NO → field picker → change status  
**Steps:**
1. `[AUDIO]` "Mark Fix login bug as done" → confirmation shown
2. `[BTN]` Tap **No, cancel** → field picker list shown
3. `[LIST]` Select **Status** → status picker shown
4. `[LIST]` Select **⏳ In Progress** → new confirmation shown  
   ```
   Task: *Fix login bug*
   • Status → in_progress
   Confirm?
   ```
   `[BUTTONS: Yes, do it | No, cancel]`
5. `[BTN]` Tap **Yes, do it** → task updated to in_progress  
**Pass/Fail (each step):** ___  ___  ___  ___  ___

---

### TC-AU-004
**Title:** Audio update — vague (no field given)  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Update Fix login bug"  
**Expected Output:** Bot asks what to update with bullet options (VAGUE UPDATE RULE)  
**Pass/Fail:** ___

---

## SECTION 9 — TASK DELETION

---

### TC-TD-001
**Title:** Delete task — text  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `delete task Fix login bug`  
**Pre-condition:** Task "Fix login bug" assigned to employee  
**Expected Output:** Task deleted confirmation  
**Verify:** Task has `deleted_at` set in DB  
**Pass/Fail:** ___

---

### TC-TD-002
**Title:** Delete task — not found  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `delete task TaskThatDoesNotExist`  
**Expected Output:** Error: task not found  
**Pass/Fail:** ___

---

## SECTION 10 — ATTENDANCE (CHECK IN / OUT)

---

### TC-AT-001
**Title:** Check in — standard  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check in`  
**Pre-condition:** Employee has NOT checked in today  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
✅ Checked in at [HH:MM AM/PM] IST
```
**Verify:** `attendance_records` row created with today's date and `check_in_time` set  
**Pass/Fail:** ___

---

### TC-AT-002
**Title:** Check in — informal phrasing "I'm in"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `I'm in`  
**Expected Output:** Same as TC-AT-001  
**Pass/Fail:** ___

---

### TC-AT-003
**Title:** Check in — "mark attendance"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `mark attendance`  
**Expected Output:** Same as TC-AT-001  
**Pass/Fail:** ___

---

### TC-AT-004
**Title:** Check in — already checked in today  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check in`  
**Pre-condition:** Employee already has a check-in record for today  
**Expected Output:**
```
You already checked in today at [HH:MM AM/PM].
```
**Must NOT:** Create a duplicate record  
**Pass/Fail:** ___

---

### TC-AT-005
**Title:** Check out — standard  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check out`  
**Pre-condition:** Employee has checked in today, NOT checked out  
**Expected Output:**
```
✅ Checked out at [HH:MM AM/PM] IST
```
**Verify:** `check_out_time` updated in `attendance_records`  
**Pass/Fail:** ___

---

### TC-AT-006
**Title:** Check out — "I'm leaving"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `I'm leaving`  
**Expected Output:** Same as TC-AT-005  
**Pass/Fail:** ___

---

### TC-AT-007
**Title:** Check out — "checkout" (no space)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `checkout`  
**Expected Output:** Same as TC-AT-005  
**Pass/Fail:** ___

---

### TC-AT-008
**Title:** Check out — without prior check-in  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check out`  
**Pre-condition:** No check-in record for today  
**Expected Output:**
```
You haven't checked in today yet. Reply *checkin* to check in first.
```
**Pass/Fail:** ___

---

### TC-AT-009
**Title:** My attendance history  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `my attendance`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** List of this month's attendance records with IST times:
```
*Your attendance this month:*
• 24 Jun 2026 — Check in: 09:15 AM IST, Check out: 06:30 PM IST
• 23 Jun 2026 — Check in: 09:00 AM IST, Check out: 06:15 PM IST
...
```
**Must NOT:** Show times in UTC or in YYYY-MM-DDTHH:MM:SS format  
**Pass/Fail:** ___

---

### TC-AT-010
**Title:** Attendance history — "show my attendance"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `show my attendance`  
**Expected Output:** Same as TC-AT-009  
**Pass/Fail:** ___

---

## SECTION 11 — TEAM ATTENDANCE (ADMIN ONLY)

---

### TC-TA-001
**Title:** Admin views team attendance  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Pre-condition:** At least 2 team members have checked in today  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
*Team Attendance — Today:*
• [Name 1] — ✅ present — In: 09:10 AM IST, Out: —
• [Name 2] — ✅ present — In: 08:55 AM IST, Out: 06:00 PM IST
• [Name 3] — ❌ absent
```
**Must NOT:**
- Show hallucinated check-in times not in the DB
- Show UTC times (must be IST)
- Deny admin access  
**Pass/Fail:** ___

---

### TC-TA-002
**Title:** Admin — "who checked in today"  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `who checked in today`  
**Expected Output:** Same as TC-TA-001  
**Pass/Fail:** ___

---

### TC-TA-003
**Title:** Employee tries team attendance — DENIED  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Expected Output:** Access denied — not authorised for this feature  
**Must NOT:** Show any team attendance data  
**Pass/Fail:** ___

---

### TC-TA-004
**Title:** Employee tries "who is in office today" — DENIED  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `who is in office today`  
**Expected Output:** Access denied  
**Pass/Fail:** ___

---

## SECTION 12 — LEAVE MANAGEMENT (EMPLOYEE)

---

### TC-LV-001
**Title:** Check leave balance  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `leave balance`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
*Your leave balance:*
• Casual Leave: [X] days remaining
• Sick Leave: [Y] days remaining
• ...
```
**Pass/Fail:** ___

---

### TC-LV-002
**Title:** "how many leaves do I have"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `how many leaves do I have`  
**Expected Output:** Same as TC-LV-001  
**Pass/Fail:** ___

---

### TC-LV-003
**Title:** List my leave requests  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `my leaves`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** List of own leave requests with status (pending/approved/rejected), dates, type  
**Pass/Fail:** ___

---

### TC-LV-004
**Title:** Apply leave — full details in one message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `apply sick leave from 28 Jun to 30 Jun reason fever`  
**Expected Response Type:** `[TEXT]`  
**Expected Output:** Leave request submitted confirmation:
```
✅ Leave request submitted!
• Type: Sick Leave
• From: 28 Jun 2026
• To: 30 Jun 2026
• Reason: fever
• Status: pending
```
**Pass/Fail:** ___

---

### TC-LV-005
**Title:** Apply leave — bot asks for missing details  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `apply leave`  
**Expected Output:** Bot asks for: leave type, start date, end date, reason  
**Pass/Fail:** ___

---

### TC-LV-006
**Title:** Apply leave — casual, just tomorrow  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `apply casual leave for tomorrow`  
**Expected Output:** Bot asks for reason (if required), then submits  
**Pass/Fail:** ___

---

### TC-LV-007
**Title:** Apply leave — invalid date range (end before start)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `apply leave from 30 Jun to 25 Jun`  
**Expected Output:** Error: end date is before start date  
**Must NOT:** Submit a leave request with invalid dates  
**Pass/Fail:** ___

---

### TC-LV-008
**Title:** "I want to take a day off tomorrow"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `I want to take a day off tomorrow`  
**Expected Output:** Bot asks for leave type and reason, then submits request  
**Pass/Fail:** ___

---

## SECTION 13 — LEAVE MANAGEMENT (ADMIN)

---

### TC-LA-001
**Title:** Admin views pending leaves  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `pending leaves`  
**Pre-condition:** At least 1 pending leave request exists  
**Expected Response Type:** `[TEXT]`  
**Expected Output:**
```
*Pending Leave Requests:*
• [Employee Name] — Sick Leave — 28 Jun to 30 Jun — "fever"
• [Employee Name 2] — Casual Leave — 1 Jul to 2 Jul — "personal work"
```
**Pass/Fail:** ___

---

### TC-LA-002
**Title:** Admin views pending — none exist  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `pending leaves`  
**Pre-condition:** Zero pending leave requests  
**Expected Output:** "No pending leave requests." or similar  
**Pass/Fail:** ___

---

### TC-LA-003
**Title:** Admin approves leave — text  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `approve leave for Tushar`  
**Expected Output:** Bot confirms approval and executes  
**Verify:** Leave request status updated to approved in DB  
**Pass/Fail:** ___

---

### TC-LA-004
**Title:** Admin approves leave — audio → confirmation  
**Role:** Admin  
**Type:** `[AUDIO]`  
**Input (speak):** "Approve leave for Pranay"  
**Expected Response Type:** `[TEXT + BUTTONS]`  
**Expected Output:**
```
Please confirm:

APPROVE the leave request.

Confirm?
```
`[BUTTONS: Yes, do it | No, cancel]`  
**Pass/Fail:** ___

---

### TC-LA-005
**Title:** Admin approve leave → YES → approved  
**Type:** `[BTN]`  
**Pre-condition:** TC-LA-004 shown  
**Input:** Tap **"Yes, do it"**  
**Expected Output:** Leave approved. Applicant notified.  
**Verify:** Status = approved in DB  
**Pass/Fail:** ___

---

### TC-LA-006
**Title:** Admin rejects leave with reason  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `reject leave for Tushar reason not enough notice given`  
**Expected Output:** Leave rejected with reason  
**Verify:** Status = rejected in DB  
**Pass/Fail:** ___

---

### TC-LA-007
**Title:** Employee tries to approve leave — DENIED  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `approve leave for Tushar`  
**Expected Output:** Access denied — not admin  
**Pass/Fail:** ___

---

## SECTION 14 — NATURAL LANGUAGE & TYPO HANDLING

---

### TC-NL-001
**Title:** Typo in "list" → "lst"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `lst my tasks`  
**Expected Output:** Task list shown (handles common typo)  
**Pass/Fail:** ___

---

### TC-NL-002
**Title:** Typo in "task" → "taks"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create taks Fix the bug`  
**Expected Output:** Task created  
**Pass/Fail:** ___

---

### TC-NL-003
**Title:** Typo in "check" → "chek"  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `chek in`  
**Expected Output:** Check-in recorded  
**Pass/Fail:** ___

---

### TC-NL-004
**Title:** WhatsApp shorthand  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `wat r my tasks`  
**Expected Output:** Task list shown  
**Pass/Fail:** ___

---

### TC-NL-005
**Title:** Task done — informal  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `fix login bug done`  
**Expected Output:** Status updated to done  
**Pass/Fail:** ___

---

### TC-NL-006
**Title:** Priority update — informal  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update fix login bug to high priority`  
**Expected Output:** Priority updated to high  
**Pass/Fail:** ___

---

### TC-NL-007
**Title:** Leave in Hindi  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `chutti chahiye kal`  
**Expected Output:** Bot asks for leave type or submits leave for tomorrow  
**Pass/Fail:** ___

---

### TC-NL-008
**Title:** Hindi/English mix — check in  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check in kar diya`  
**Expected Output:** Check-in recorded  
**Pass/Fail:** ___

---

### TC-NL-009
**Title:** Task with dashes in title  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `add task - Write test cases - assign to me - urgent`  
**Expected Output:** Task created: title="Write test cases", priority=urgent  
**Pass/Fail:** ___

---

### TC-NL-010
**Title:** Extremely short message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `tasks`  
**Expected Output:** Task list shown  
**Pass/Fail:** ___

---

### TC-NL-011
**Title:** All caps message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `CHECK IN`  
**Expected Output:** Check-in recorded (case-insensitive)  
**Pass/Fail:** ___

---

## SECTION 15 — EDGE CASES

---

### TC-EC-001
**Title:** Empty / blank message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** ` ` (space only)  
**Expected Output:** Bot asks what the user needs, or shows help menu  
**Must NOT:** Crash or return empty response  
**Pass/Fail:** ___

---

### TC-EC-002
**Title:** Only punctuation  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `...`  
**Expected Output:** Bot asks what the user needs  
**Pass/Fail:** ___

---

### TC-EC-003
**Title:** Only numbers  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `123456`  
**Expected Output:** Bot asks what the user needs  
**Pass/Fail:** ___

---

### TC-EC-004
**Title:** Create task — no title given  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task for tomorrow high priority`  
**Expected Output:** Bot asks: "What should the task title be?"  
**Must NOT:** Create a task without a title  
**Pass/Fail:** ___

---

### TC-EC-005
**Title:** Update — ambiguous task name (no name given)  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update that task`  
**Pre-condition:** No recent task mentioned in conversation  
**Expected Output:** Bot asks which task to update  
**Pass/Fail:** ___

---

### TC-EC-006
**Title:** CRITICAL — Date stored without time when no time given  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Test ABC due 30 Jun`  
**Expected Output:** Task created. Deadline = "30 Jun 2026" (no time shown)  
**Verify in DB:** `deadline` column = `2026-06-30` (not `2026-06-30T18:29:00`)  
**Pass/Fail:** ___

---

### TC-EC-007
**Title:** Date with explicit time — time IS stored  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Test ABC due 30 Jun at 5pm`  
**Expected Output:** Task created. Deadline = "30 Jun 2026 at 05:00 PM"  
**Verify in DB:** `deadline` column has time component `T17:00:00`  
**Pass/Fail:** ___

---

### TC-EC-008
**Title:** Very long message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `I need to create a task for the upcoming project meeting where we will be discussing the quarterly targets and I want to assign it to Tushar and the deadline should be end of this month and priority should be high and also can you tell me my leave balance at the same time`  
**Expected Output:** Bot handles the request — either creates the task and shows leave balance, or asks clarifying questions. Does NOT crash or return an error.  
**Pass/Fail:** ___

---

### TC-EC-009
**Title:** Multiple requests in one message  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `check in and also show my tasks`  
**Expected Output:** Check-in recorded AND tasks listed in one reply  
**Pass/Fail:** ___

---

## SECTION 16 — ACCESS CONTROL

---

### TC-AC-001
**Title:** Employee cannot access team attendance  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Expected Output:** Access denied  
**Must NOT:** Return any team data  
**Pass/Fail:** ___

---

### TC-AC-002
**Title:** Employee cannot access pending leaves  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `list pending leaves`  
**Expected Output:** Access denied  
**Pass/Fail:** ___

---

### TC-AC-003
**Title:** Employee cannot approve leave  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `approve leave for Tushar`  
**Expected Output:** Access denied  
**Pass/Fail:** ___

---

### TC-AC-004
**Title:** Employee can only see own tasks  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `list all tasks`  
**Expected Output:** Only the employee's own tasks (not all org tasks)  
**Pass/Fail:** ___

---

### TC-AC-005
**Title:** Admin "all tasks" shows everyone's tasks  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `list tasks`  
**Expected Output:** All tasks in the organisation (not just admin's)  
**Pass/Fail:** ___

---

### TC-AC-006
**Title:** Admin "my tasks" shows only admin's tasks  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `my tasks`  
**Expected Output:** Only admin's own assigned tasks  
**Pass/Fail:** ___

---

## SECTION 17 — REPLY FORMAT CHECKS

---

### TC-RF-001
**Title:** Task list — no YYYY-MM-DD in response  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `list tasks`  
**Check:** Response must NOT contain any date in `YYYY-MM-DD` format  
**Expected:** All dates as "24 Jun 2026" or similar  
**Pass/Fail:** ___

---

### TC-RF-002
**Title:** Confirmation — shows buttons (not text "1. Yes 2. No")  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input:** Any CRUD voice message  
**Check:** WhatsApp renders actual interactive buttons, not plain "1. Yes 2. No" text  
**Pass/Fail:** ___

---

### TC-RF-003
**Title:** Field picker — shows as WhatsApp list (not plain bullets)  
**Role:** Employee  
**Type:** `[BTN]`  
**Input:** Tap **No, cancel** on any confirmation  
**Check:** WhatsApp renders an interactive list picker (tap to open), not plain "• Title • Priority ..." text  
**Pass/Fail:** ___

---

### TC-RF-004
**Title:** No raw JSON in any reply  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** Any complex message  
**Check:** Response NEVER contains `{"function_calls":`, ` ```json `, `"name":"create_task"`, or similar  
**Pass/Fail:** ___

---

### TC-RF-005
**Title:** Attendance times always in IST  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Check:** All times shown as HH:MM AM/PM IST — never UTC or ISO format  
**Pass/Fail:** ___

---

### TC-RF-006
**Title:** Bot uses *bold* for key information  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task Review PR assign to me`  
**Check:** Task title appears as `*Review PR*` in the response  
**Pass/Fail:** ___

---

## SECTION 18 — REGRESSION TESTS (Must Never Break Again)

---

### TC-RG-001
**Title:** Bot invented deadline — must NOT happen  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task ABC` (no date given)  
**Expected:** No deadline in the reply, no deadline in DB  
**Regression:** Previously bot was setting deadline = current time  
**Pass/Fail:** ___

---

### TC-RG-002
**Title:** "update due time" without value — must ask  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `update testing task 1 due time`  
**Expected:** Bot asks "What should the new deadline be?"  
**Regression:** Previously bot was responding "updated to 18:29:00" (same time, no change)  
**Pass/Fail:** ___

---

### TC-RG-003
**Title:** Admin NOT denied team attendance  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Expected:** Team attendance data shown  
**Regression:** Previously admin was getting "You can only see your own attendance"  
**Pass/Fail:** ___

---

### TC-RG-004
**Title:** Team attendance shows real IST times  
**Role:** Admin  
**Type:** `[TEXT]`  
**Input:** `team attendance`  
**Expected:** Times match Supabase DB values converted to IST  
**Regression:** Previously bot was hallucinating check-in times  
**Pass/Fail:** ___

---

### TC-RG-005
**Title:** Audio CRUD shows confirmation FIRST  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Create task XYZ"  
**Expected:** Confirmation card shown, task NOT created yet  
**Regression:** Previously bot was creating the task immediately without confirmation  
**Pass/Fail:** ___

---

### TC-RG-006
**Title:** Yes/No are actual buttons (not text)  
**Role:** Employee  
**Type:** `[AUDIO]`  
**Input (speak):** "Create task XYZ assign to me"  
**Expected:** WhatsApp interactive buttons rendered  
**Regression:** Previously only plain text "Confirm?" appeared with no buttons  
**Pass/Fail:** ___

---

### TC-RG-007
**Title:** No JSON leakage in replies  
**Role:** Employee  
**Type:** `[TEXT]`  
**Input:** `create task complicated request with many details assign to Tushar due next week urgent`  
**Expected:** Clean natural language response, no raw JSON  
**Regression:** Groq LLM occasionally outputs tool call JSON as markdown  
**Pass/Fail:** ___

---

### TC-RG-008
**Title:** AI Agent node — no syntax error  
**Check:** Open n8n → AI Agent node → no "Invalid or unexpected token" error  
**Regression:** taskRules had a real newline inside a JS single-quoted string  
**Pass/Fail:** ___

---

## SECTION 19 — FULL END-TO-END FLOWS

---

### E2E-001: Employee Voice → Create → No → Change Priority → Yes

| Step | Type | Action | Expected |
|------|------|--------|----------|
| 1 | `[AUDIO]` | Speak: "Create task Submit report assign to me" | Confirmation card + Yes/No buttons |
| 2 | `[BTN]` | Tap **No, cancel** | Field picker list |
| 3 | `[LIST]` | Select **Priority** | Priority picker (Low/Medium/High/Urgent) |
| 4 | `[LIST]` | Select **🔴 Urgent** | New confirmation with priority=urgent + Yes/No buttons |
| 5 | `[BTN]` | Tap **Yes, do it** | ✅ Task created with priority=urgent |

**Final verify:** Task in DB with priority = 'urgent', no deadline  
**Pass/Fail:** ___ ___ ___ ___ ___

---

### E2E-002: Admin Text → Create → No confirmation (text is immediate)

| Step | Type | Action | Expected |
|------|------|--------|----------|
| 1 | `[TEXT]` | "create task Quarterly Review assign to Pranay due 30 Jun high priority" | Task created immediately, no confirmation needed |
| 2 | `[TEXT]` | "list tasks" | Task "Quarterly Review" appears with correct date and priority |

**Pass/Fail:** ___ ___

---

### E2E-003: Employee → Check in → Work → Check out → View attendance

| Step | Type | Action | Expected |
|------|------|--------|----------|
| 1 | `[TEXT]` | "check in" | ✅ Checked in at [time] IST |
| 2 | `[TEXT]` | "check out" | ✅ Checked out at [time] IST |
| 3 | `[TEXT]` | "my attendance" | Today's row shows both check-in and check-out in IST |

**Pass/Fail:** ___ ___ ___

---

### E2E-004: Employee → Apply Leave → Admin Approves (Audio)

| Step | Role | Type | Action | Expected |
|------|------|------|--------|----------|
| 1 | Employee | `[TEXT]` | "apply sick leave from 1 Jul to 2 Jul reason fever" | Leave request submitted |
| 2 | Admin | `[TEXT]` | "pending leaves" | Shows the new request |
| 3 | Admin | `[AUDIO]` | Speak: "Approve leave for [Employee Name]" | Confirmation + Yes/No buttons |
| 4 | Admin | `[BTN]` | Tap **Yes, do it** | Leave approved |

**Final verify:** Leave request status = approved in DB  
**Pass/Fail:** ___ ___ ___ ___

---

### E2E-005: Voice Update → No → Change Status → No → Change Title → Yes

| Step | Type | Action | Expected |
|------|------|--------|----------|
| 1 | `[AUDIO]` | "Mark Fix login bug as done" | Confirmation card |
| 2 | `[BTN]` | Tap **No, cancel** | Field picker |
| 3 | `[LIST]` | Select **Status** | Status picker |
| 4 | `[LIST]` | Select **⏳ In Progress** | New confirmation with status=in_progress |
| 5 | `[BTN]` | Tap **No, cancel** | Field picker again |
| 6 | `[LIST]` | Select **Title** | "What should the new title be?" |
| 7 | `[TEXT]` | "Fix authentication bug" | New confirmation with new title |
| 8 | `[BTN]` | Tap **Yes, do it** | ✅ Task updated with new title |

**Pass/Fail:** ___ ___ ___ ___ ___ ___ ___ ___

---

## Test Summary Sheet

| Section | Total Cases | Passed | Failed | Not Run |
|---------|-------------|--------|--------|---------|
| 1 — Greetings | 9 | | | |
| 2 — Help | 3 | | | |
| 3 — Daily Briefing | 4 | | | |
| 4 — Task Listing | 10 | | | |
| 5 — Task Creation (Text) | 10 | | | |
| 6 — Task Creation (Audio) | 14 | | | |
| 7 — Task Updating (Text) | 15 | | | |
| 8 — Task Updating (Audio) | 4 | | | |
| 9 — Task Deletion | 2 | | | |
| 10 — Attendance | 10 | | | |
| 11 — Team Attendance | 4 | | | |
| 12 — Leave (Employee) | 8 | | | |
| 13 — Leave (Admin) | 7 | | | |
| 14 — Natural Language | 11 | | | |
| 15 — Edge Cases | 9 | | | |
| 16 — Access Control | 6 | | | |
| 17 — Reply Format | 6 | | | |
| 18 — Regression | 8 | | | |
| 19 — End-to-End Flows | 5 flows | | | |
| **TOTAL** | **~165** | | | |

---

*Generated by Claude Sonnet 4.6 — Leadership Edge Live HRBot*
