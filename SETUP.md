# WhatsApp AI HR Management System — Setup Guide

## Prerequisites
- Node.js 18+
- Supabase account
- Anthropic API key (Claude)
- WhatsApp Business account + Cloud API access
- n8n instance (self-hosted or n8n.cloud)
- Vercel account

---

## Step 1 — Clone & Install

```bash
cd C:\Users\HP\Desktop\WHATSAPP
npm install
```

---

## Step 2 — Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
copy .env.example .env.local
```

Required values:
- `NEXT_PUBLIC_SUPABASE_URL` — from Supabase project settings
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase project settings
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `WHATSAPP_PHONE_NUMBER_ID` — from Meta Developer Portal
- `WHATSAPP_ACCESS_TOKEN` — from Meta Developer Portal
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — any random string you choose
- `N8N_BASE_URL` — your n8n instance URL
- `N8N_WEBHOOK_SECRET` — any random string
- `APP_SECRET` — any random 32+ char string

---

## Step 3 — Supabase Setup

1. Create a new Supabase project
2. Run migrations in order:

```bash
# Using Supabase CLI
npx supabase db push

# OR manually run each file in:
# supabase/migrations/001_core_tables.sql
# supabase/migrations/002_task_tables.sql
# supabase/migrations/003_onboarding_tables.sql
# supabase/migrations/004_leave_attendance.sql
# supabase/migrations/005_rls_policies.sql
```

3. Run seed data:
```sql
-- Run supabase/seed.sql in Supabase SQL editor
```

4. Enable Realtime on tables:
   - Go to Supabase > Database > Replication
   - Enable for: `tasks`, `attendance_records`, `leave_requests`, `messages`

---

## Step 4 — n8n Setup

1. Import workflows from `n8n/workflows/` folder into your n8n instance
2. Set environment variables in n8n:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_ACCESS_TOKEN`
   - `NEXT_APP_URL`

---

## Step 5 — WhatsApp Webhook

1. Deploy to Vercel: `vercel deploy`
2. In Meta Developer Portal:
   - Go to WhatsApp > Configuration
   - Webhook URL: `https://your-app.vercel.app/api/webhooks/whatsapp`
   - Verify Token: same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to: `messages`

---

## Step 6 — First Admin User

1. Go to Supabase > Authentication > Users > Add User
2. Create admin user with email/password
3. In SQL editor, update their role:
```sql
UPDATE users 
SET role = 'admin', 
    organization_id = '00000000-0000-0000-0000-000000000001'
WHERE email = 'your@email.com';
```

---

## Step 7 — Test WhatsApp

Send a message to your WhatsApp Business number:
```
"Hello"           → Welcome message
"Show my tasks"   → Task list
"Checkin"         → Mark attendance
"Apply casual leave tomorrow" → Leave flow
```

---

## Project Structure

```
src/
├── app/
│   ├── api/webhooks/whatsapp/   ← WA webhook receiver
│   ├── api/agent/               ← AI agent API (used by n8n)
│   ├── (auth)/login/            ← Login page
│   └── (dashboard)/             ← All dashboard pages
├── lib/
│   ├── ai/                      ← Master AI agent + tools
│   ├── whatsapp/                ← WA Cloud API client
│   ├── supabase/                ← DB clients
│   ├── n8n/                     ← n8n trigger helpers
│   └── utils/                   ← Date, audit, etc.
├── components/                  ← React UI components
├── hooks/                       ← Realtime hooks
└── types/                       ← TypeScript types

supabase/migrations/             ← Database schema
n8n/workflows/                   ← n8n workflow JSONs
```

---

## WhatsApp Commands (Examples)

| Message | Action |
|---------|--------|
| `Hello` / `Hi` | Welcome + capabilities |
| `Create task call client today` | AI creates task, asks for details |
| `Assign website work to Rahul by Friday` | Creates + assigns task |
| `Show my pending tasks` | Lists user's tasks |
| `Mark complete [task]` | Completes a task |
| `Checkin` | Marks attendance check-in |
| `Checkout` | Marks attendance check-out |
| `Apply sick leave tomorrow` | Starts leave application flow |
| `My leave balance` | Shows remaining leaves |
| `Who is absent today` | Shows absent employees (managers) |
| `Onboard Rahul +91XXXXXXXXXX` | Starts onboarding flow |

Hindi examples:
- `मेरी हाजिरी लगाओ` → Check-in
- `कल छुट्टी चाहिए` → Apply leave
- `मेरे टास्क दिखाओ` → Show tasks
