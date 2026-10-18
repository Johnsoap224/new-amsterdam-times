-- Apply this migration in the Supabase SQL editor before enabling newsletter sends.

alter table public.subscribers
  add column if not exists delivery_status text;

comment on column public.subscribers.delivery_status is
  'Resend delivery state: active, unsubscribed, bounced, or complained.';

create table if not exists public.newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  content_hash text not null,
  mode text not null check (mode in ('send', 'schedule')),
  status text not null check (status in ('preparing', 'queued', 'scheduled', 'sent', 'failed', 'cancelled')),
  resend_broadcast_id text unique,
  scheduled_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_newsletter_sends_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists newsletter_sends_set_updated_at on public.newsletter_sends;
create trigger newsletter_sends_set_updated_at
before update on public.newsletter_sends
for each row execute function public.set_newsletter_sends_updated_at();

alter table public.newsletter_sends enable row level security;

comment on table public.newsletter_sends is
  'Server-only send ledger that prevents an article newsletter from being sent twice.';
