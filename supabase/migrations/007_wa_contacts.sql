-- WhatsApp Contacts
-- Stores a phone-book of contacts per organization.
-- Used by the WA Logs "Contacts" tab to initiate new conversations.

create table if not exists wa_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  created_by       uuid references users(id) on delete set null,
  name             text not null,
  wa_number        text not null,          -- digits only, no +
  notes            text,
  created_at       timestamptz not null default now(),

  unique (organization_id, wa_number)      -- one entry per number per org
);

create index if not exists wa_contacts_org_idx on wa_contacts(organization_id);

-- RLS: any authenticated member of the org can read/write contacts
alter table wa_contacts enable row level security;

create policy "org members can manage contacts"
  on wa_contacts for all
  using (
    organization_id in (
      select organization_id from users where id = auth.uid()
    )
  );
