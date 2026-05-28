-- Add WhatsApp template configuration to organizations
-- These are used for business-initiated messages (bypasses 24h window)

alter table organizations
  add column if not exists wa_message_template   text,         -- e.g. "hrbot_general"
  add column if not exists wa_template_lang      text default 'en',   -- e.g. "en", "hi", "en_US"
  add column if not exists wa_template_variables integer default 2;   -- 1=msg only, 2=name+msg, 3=name+msg+org
