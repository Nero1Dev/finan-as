-- ============================================================
-- MIGRAÇÃO — lançamentos fixos podem ser receita (ex: salário) além de
-- despesa.
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- antes desta mudança. Se está criando o projeto do zero, não precisa
-- disso: use o schema.sql atual, que já vem assim.
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

alter table recurring_expenses add column if not exists kind text not null default 'despesa'
  check (kind in ('receita','despesa'));
