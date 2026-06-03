alter table messages add column if not exists is_announcement boolean not null default false;

create index if not exists idx_messages_announcement on messages (channel_id) where is_announcement = true;
