-- Add invite link expiry and usage-limit columns to servers table.
-- invite_expires_at: null = never expires
-- invite_max_uses:   null = unlimited
-- invite_used_count: incremented on every successful join via invite code

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS invite_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_max_uses    INT,
  ADD COLUMN IF NOT EXISTS invite_used_count  INT NOT NULL DEFAULT 0;
