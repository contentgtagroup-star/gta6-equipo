-- Ejecutar una vez con el administrador de Supabase.
create table if not exists public.publicacion_docs (
  coleccion text not null check (coleccion in ('fuentes','sugerencias','cola','trabajos','eventos','conexiones','oauth','metricas')),
  id text not null,
  datos jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  actualizado timestamptz not null default now(),
  primary key (coleccion, id)
);
alter table public.publicacion_docs enable row level security;
revoke all on public.publicacion_docs from anon, authenticated;
grant all on public.publicacion_docs to service_role;
