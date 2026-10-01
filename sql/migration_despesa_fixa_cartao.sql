-- ============================================================
-- MIGRAÇÃO — despesa fixa paga no cartão de crédito.
-- Quando card_id está preenchido, cada ocorrência mensal entra como
-- compra na fatura do cartão (não mexe no saldo; quem mexe é o
-- pagamento da fatura), em vez de sair direto da conta.
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- antes desta mudança. Se está criando o projeto do zero, não precisa
-- disso: use o schema.sql atual, que já vem assim.
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

alter table recurring_expenses add column if not exists card_id uuid references cards(id) on delete set null;
