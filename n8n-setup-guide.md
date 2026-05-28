# n8n HRBot Workflow Setup Guide

## Step 1: Import the Workflow

1. Open your n8n instance
2. Click **Workflows** → **Import from file**
3. Select `n8n-hrbot-workflow.json`
4. Click **Import**

---

## Step 2: Set Environment Variables in n8n

Go to **Settings** → **Variables** (or use `.env` if self-hosting) and add:

| Variable Name | Value |
|---|---|
| `SUPABASE_URL` | `https://icobloqimszzcqtphxvr.supabase.co` |
| `SUPABASE_KEY` | Your Supabase service role key from `.env.local` |
| `WHATSAPP_PHONE_NUMBER_ID` | `1069159539605344` |
| `WHATSAPP_ACCESS_TOKEN` | Your WhatsApp token from `.env.local` |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` from `.env.local` |
| `N8N_WEBHOOK_SECRET` | `hrbot_webhook_secret_2026` |

> ⚠️ If using n8n Cloud, add these under **Settings → Environment Variables**.
> If self-hosting, add to your `.env` file and restart n8n.

---

## Step 3: Activate the Workflow

1. Open the imported workflow
2. Click the toggle to **Activate** it
3. Copy the webhook URL shown on the **WhatsApp Webhook** node
   - It will look like: `https://your-n8n.com/webhook/whatsapp-webhook`

---

## Step 4: Configure WhatsApp Webhook

1. Go to [Meta Developer Console](https://developers.facebook.com)
2. Select your WhatsApp app → **WhatsApp** → **Configuration**
3. Under **Webhook**, click **Edit**:
   - **Callback URL**: `https://your-n8n.com/webhook/whatsapp-webhook`
   - **Verify Token**: `hrbot_webhook_secret_2026`
4. Subscribe to **messages** field
5. Click **Verify and Save**

---

## Step 5: Register Employee Phone Numbers

For the bot to identify users, each employee's WhatsApp number must be stored in the `users` table:

```sql
UPDATE users 
SET wa_number = '919876543210'   -- country code + number, no + sign
WHERE email = 'employee@company.com';
```

Or via the Settings page in the HRBot dashboard.

---

## Workflow Architecture

```
WhatsApp Message
    ↓
Extract Phone + Text
    ↓
Lookup User (Supabase)
    ↓
Claude AI → Classify Intent
    ↓
Switch on Intent
    ├── attendance_checkin → Check + INSERT attendance_records
    ├── attendance_checkout → Find record + UPDATE check_out_time
    ├── list_tasks → SELECT tasks WHERE assignee_id = user
    ├── apply_leave → Parse dates + INSERT leave_requests
    ├── leave_balance → SELECT leave_balances
    ├── help → Static command list
    └── general_chat → Claude AI free response
    ↓
Save message to DB
    ↓
Send WhatsApp reply (Graph API v20.0)
```

---

## Supported Commands (WhatsApp messages)

| User says | Bot does |
|---|---|
| `checkin` / `good morning` / `i'm in` | Marks attendance check-in |
| `checkout` / `leaving` / `done for today` | Marks attendance check-out |
| `my tasks` / `tasks` / `pending work` | Lists active tasks |
| `leave balance` / `how many leaves` | Shows leave balance |
| `apply casual leave 2026-06-10 to 2026-06-12` | Creates leave request |
| `help` / `commands` / `what can you do` | Shows help menu |
| Anything else | Claude AI free response |

---

## Troubleshooting

**Bot not responding?**
- Check workflow is activated
- Verify webhook URL is correct in Meta Console
- Check n8n execution logs

**User not found?**
- Ensure `wa_number` column is set in `users` table
- Format: country code + number (e.g., `919876543210`)

**Leave balance 0?**
- Run the setup API again or execute the leave balance seeding SQL
- Admins skip the balance check automatically
