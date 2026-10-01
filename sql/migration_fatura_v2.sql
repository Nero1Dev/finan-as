-- ============================================================
-- MIGRAÇÃO — fatura do cartão v2.
--
-- O que muda:
--  * Compras no cartão deixam de ter "PAGO/PENDENTE" uma a uma e nunca
--    mexem no saldo da conta. Quem mexe no saldo é o PAGAMENTO da fatura,
--    que vira um lançamento próprio (transactions.pays_invoice_id).
--  * Restante de fatura paga parcialmente pode ser jogado pra próxima
--    fatura (par de lançamentos com carryover = true).
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- antes desta mudança. Se está criando o projeto do zero, não precisa
-- disso: use o schema.sql atual, que já vem assim.
--
-- IMPORTANTE: rode ANTES de publicar a nova versão do app.
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- 1) Novas colunas
alter table transactions add column if not exists pays_invoice_id uuid references invoices(id) on delete set null;
alter table transactions add column if not exists carryover boolean not null default false;
create index if not exists idx_transactions_pays_invoice on transactions(pays_invoice_id);

-- 2) Converte o "pago" antigo (compra por compra) em lançamentos de
-- pagamento de fatura. Um pagamento por fatura + conta, com a soma das
-- compras que estavam marcadas como pagas, então o saldo de cada conta
-- continua exatamente igual. Pode rodar mais de uma vez sem duplicar.
insert into transactions (description, amount, kind, date, account_id, category_id, paid, pays_invoice_id, created_by)
select
  'Pagamento fatura ' || c.name || ' · ' || to_char(i.due_date, 'MM/YY'),
  sum(t.amount),
  'despesa',
  least(i.due_date, current_date),
  t.account_id,
  (select id from categories where name = 'Cartão de crédito' and kind = 'despesa' limit 1),
  true,
  i.id,
  t.created_by
from transactions t
join invoices i on i.id = t.invoice_id
join cards c on c.id = i.card_id
where t.card_id is not null
  and t.paid = true
  and not exists (select 1 from transactions p where p.pays_invoice_id = i.id)
group by i.id, c.name, i.due_date, t.account_id, t.created_by;

-- 3) Conferência (opcional): saldo por conta deve bater com o de antes.
-- select account_id, sum(case when kind = 'receita' then amount else -amount end)
-- from transactions
-- where card_id is null and (kind = 'receita' or paid)
-- group by account_id;
