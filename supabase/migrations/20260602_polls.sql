create table if not exists polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  is_multiple_choice BOOLEAN NOT NULL DEFAULT false,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

create table if not exists poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

create table if not exists poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_option_id UUID REFERENCES poll_options(id) ON DELETE CASCADE,
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(poll_option_id, user_id)
);

create index if not exists idx_poll_options_poll_id ON poll_options(poll_id);
create index if not exists idx_poll_votes_poll_id ON poll_votes(poll_id);
create index if not exists idx_poll_votes_poll_option_id ON poll_votes(poll_option_id);

-- RLS
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

drop policy if exists "polls_select" on polls;
CREATE POLICY "polls_select" ON polls FOR SELECT USING (true);
drop policy if exists "polls_insert" on polls;
CREATE POLICY "polls_insert" ON polls FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_id AND m.author_id = auth.uid()
  )
);

drop policy if exists "poll_options_select" on poll_options;
CREATE POLICY "poll_options_select" ON poll_options FOR SELECT USING (true);
drop policy if exists "poll_options_insert" on poll_options;
CREATE POLICY "poll_options_insert" ON poll_options FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM polls p
    JOIN messages m ON m.id = p.message_id
    WHERE p.id = poll_id AND m.author_id = auth.uid()
  )
);

drop policy if exists "poll_votes_select" on poll_votes;
CREATE POLICY "poll_votes_select" ON poll_votes FOR SELECT USING (true);
drop policy if exists "poll_votes_insert" on poll_votes;
CREATE POLICY "poll_votes_insert" ON poll_votes FOR INSERT WITH CHECK (user_id = auth.uid());
drop policy if exists "poll_votes_delete" on poll_votes;
CREATE POLICY "poll_votes_delete" ON poll_votes FOR DELETE USING (user_id = auth.uid());

-- Realtime for live vote updates
ALTER TABLE poll_votes REPLICA IDENTITY FULL;
