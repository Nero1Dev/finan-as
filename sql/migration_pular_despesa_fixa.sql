-- ============================================================
-- MIGRAÇÃO — corrige o bug de despesa fixa "ressuscitar": até aqui,
-- excluir o lançamento de um mês específico de uma despesa fixa não
-- adiantava, porque o app recriava ele de novo no próximo carregamento.
-- Essa tabela guarda os meses que você excluiu de propósito, pra não
-- gerar de novo.
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- antes desta mudança. Se está criando o projeto do zero, não precisa
-- disso: use o schema.sql atual, que já vem assim.
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create table if not exists recurring_skips (
  recurring_id uuid not null references recurring_expenses(id) on delete cascade,
  month text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recurring_id, month)
);

alter table recurring_skips enable row level security;

create policy "dono ve e edita seus meses pulados" on recurring_skips
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);
