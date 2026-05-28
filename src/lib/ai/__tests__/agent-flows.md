# AI Agent Conversation Flow Traces

## Flow 1: Task Creation (Missing fields, multi-turn)

```
USER: "Create task call client"
→ classify: CREATE_TASK, extracted: {title: "call client"}
→ state: SLOT_FILLING, pending_slot: assignee

BOT: "Who should I assign this to? (Name or "me")"

USER: "Rahul"
→ extract slot: assignee = "Rahul"
→ state: SLOT_FILLING, pending_slot: deadline

BOT: "What is the deadline? (e.g. today 5pm, tomorrow, 25 May)"

USER: "Today 7 PM"
→ extract slot: deadline = "2025-05-14 19:00"
→ all required slots filled → state: CONFIRMING

BOT: "📋 Confirm new task:
• title: call client
• assignee: Rahul
• deadline: 2025-05-14 19:00

Reply *Yes* to confirm or *No* to cancel."

USER: "Yes"
→ is_affirmative: true → state: EXECUTING
→ executeTool(CREATE_TASK, {title, assignee, deadline})

BOT: "✅ Task created!

📋 *call client*
👤 Assigned to: Rahul
⏰ Due: 14 May 2025

What else can I help with?"
```

---

## Flow 2: Leave Application (Hindi, with balance check)

```
USER: "kal leave chahiye" (hindi)
→ classify: APPLY_LEAVE, language: hi
→ state: SLOT_FILLING, pending_slot: leave_type

BOT: "किस प्रकार की छुट्टी? (Casual / Sick / Annual)"

USER: "casual"
→ extract: leave_type = "casual"
→ start_date = "tomorrow" implicitly, but missing confirmation
→ pending_slot: start_date

BOT: "किस तारीख से? (जैसे कल, 25 मई)"

USER: "kal se" (from tomorrow)
→ extract: start_date = "2025-05-15"
→ pending_slot: end_date

BOT: "किस तारीख तक? (या कितने दिन?)"

USER: "1 din"
→ extract: duration_days = "1", end_date = same as start
→ all required filled → CONFIRMING

BOT: "📅 Confirm leave request:
• leave_type: casual
• start_date: 2025-05-15
• end_date: 2025-05-15
• duration: 1 day

*Yes* भेजें confirm करने के लिए, *No* भेजें cancel करने के लिए।"

USER: "haan"
→ is_affirmative: true → EXECUTING

BOT: "📅 छुट्टी आवेदन जमा!
🏷️ *Casual Leave*
📆 15 May → 15 May
📊 1 दिन
✅ स्थिति: Pending approval"
```

---

## Flow 3: Attendance Check-In (No slots needed)

```
USER: "checkin"
→ classify: CHECK_IN (no slots needed)
→ state: EXECUTING immediately

BOT: "✅ Attendance marked! Priya, you checked in at *09:15 AM*.
Have a productive day! 💪"
```

---

## Flow 4: Leave Approval (Manager flow)

```
MANAGER: "approve Rahul leave"
→ classify: APPROVE_LEAVE
→ SLOT_FILLING: pending_slot = employee_name (already extracted!)
→ slots: {employee_name: "Rahul"} → CONFIRMING

BOT: "✅ Confirm action:
• employee_name: Rahul

Reply *Yes* to confirm or *No* to cancel."

MANAGER: "yes"
→ EXECUTING

BOT: "✅ *Rahul*'s Casual leave approved!
📆 15 May 2025 — 15 May 2025

They'll be notified on WhatsApp."

[Rahul receives]: "✅ Your Casual leave has been *approved* by *your manager*!
📆 15 May 2025 — 15 May 2025
Enjoy your time off! 🌴"
```

---

## Flow 5: Interruption / Topic Switch

```
USER: "create task report submission"
→ state: SLOT_FILLING, pending: assignee

BOT: "Who should I assign this to?"

USER: "actually show my tasks first"
→ new intent: LIST_TASKS → interrupts CREATE_TASK flow
→ old context cleared, LIST_TASKS executes immediately

BOT: "📋 *Your tasks:*
1. ⏳ *Call client* — 14 May 2025
2. ⏳ *Website design review* — 16 May 2025
3. 🔄 *HR policy update* — No deadline"
```

---

## Flow 6: Error Recovery (Slot retry)

```
USER: "apply leave"
→ SLOT_FILLING: pending: leave_type

BOT: "What type of leave? (Casual / Sick / Annual)"

USER: "picnic"
→ not a valid enum → retry_count: 1

BOT: "Hmm, I didn't catch that. What type of leave? (Casual / Sick / Annual)"

USER: "something random"
→ retry_count: 2 → hint shown

BOT: "Hmm, I didn't catch that. What type of leave? (Casual / Sick / Annual)
💡 Available types: Casual, Sick, Annual, Maternity"

USER: "still wrong"
→ retry_count: 3 → RESET

BOT: "I couldn't get the information I needed. Let's try again — what do you need help with?"
```

---

## Flow 7: Onboarding New Employee

```
HR: "onboard new employee"
→ SLOT_FILLING: pending: employee_name

BOT: "New employee's full name?"

HR: "Rahul Sharma"
→ pending: wa_number

BOT: "Their WhatsApp number? (with country code, e.g. +919876543210)"

HR: "+919876543210"
→ valid → pending: department (optional)

BOT: "Which department? (optional)"

HR: "skip"
→ SKIP → pending: designation (optional)

BOT: "Designation/role title? (optional)"

HR: "skip"
→ all slots done → CONFIRMING

BOT: "👤 Confirm new employee onboarding:
• employee_name: Rahul Sharma
• wa_number: +919876543210

Reply *Yes* to confirm or *No* to cancel."

HR: "yes"
→ EXECUTING

BOT: "👤 Onboarding started for *Rahul Sharma*!
Instructions are being sent to their WhatsApp now."

[Rahul receives]: "🎉 Welcome to your company, Rahul Sharma!
I'm HRBot — your AI HR assistant.
I'll guide you through your onboarding process.
Reply with anything to begin! 👋"
```
