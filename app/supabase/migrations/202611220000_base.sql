-- Base del panel: documentos del equipo y bucket de clips.
-- Ejecutar una vez en el SQL Editor de Supabase.
create table if not exists public.docs (
  coleccion text not null,
  id text not null,
  datos jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  actualizado timestamptz not null default now(),
  primary key (coleccion, id)
);
alter table public.docs enable row level security;
revoke all on public.docs from anon, authenticated;
grant all on public.docs to service_role;

-- Bucket privado para clips y material de publicaciones.
insert into storage.buckets (id, name, public)
values ('clips', 'clips', false)
on conflict (id) do nothing;
