-- ============================================================
-- MIGRAÇÃO — guarda a data original de uma receita futura quando ela é
-- marcada como "recebida" pelo botão "A RECEBER", pra dar pra desfazer
-- (clicar em "RECEBIDO" volta a data de vencimento anterior).
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- antes desta mudança. Se está criando o projeto do zero, não precisa
-- disso: use o schema.sql atual, que já vem assim.
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

alter table transactions add column if not exists original_date date;
