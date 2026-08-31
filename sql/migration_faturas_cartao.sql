-- ============================================================
-- MIGRAÇÃO — cartão de crédito com fatura própria (deixa de ser uma
-- "conta com saldo" e passa a ter cards + invoices, com compras que só
-- afetam o saldo da conta quando a fatura é paga).
--
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- com o schema.sql antigo. Se está criando o projeto do zero, não
-- precisa disso: use o schema.sql atual, que já vem assim.
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- 1) Novas tabelas
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  limit_amount numeric(12,2),
  closing_day int not null check (closing_day between 1 and 28),
  due_day int not null check (due_day between 1 and 28),
  payment_account_id uuid references accounts(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  reference_month text not null,
  closing_date date not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (card_id, reference_month)
);

-- 2) Novas colunas em transactions
alter table transactions add column if not exists card_id uuid references cards(id) on delete set null;
alter table transactions add column if not exists invoice_id uuid references invoices(id) on delete set null;
create index if not exists idx_transactions_invoice on transactions(invoice_id);

-- 3) RLS das tabelas novas
alter table cards enable row level security;
alter table invoices enable row level security;

create policy "dono ve e edita seus cartoes" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dono ve e edita suas faturas" on invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4) Remove a conta antiga tipo "cartão" (confirmado: arquivada e sem
-- nenhum lançamento vinculado — id conferido antes de rodar esta migração).
-- Se você tiver outra conta tipo 'cartao' com lançamentos, NÃO rode esta
-- linha sem antes decidir o que fazer com o histórico dela.
delete from accounts where type = 'cartao' and archived = true
  and not exists (select 1 from transactions where transactions.account_id = accounts.id)
  and not exists (select 1 from recurring_expenses where recurring_expenses.account_id = accounts.id);

-- 5) Trava o tipo de conta pra não aceitar mais 'cartao'
alter table accounts drop constraint if exists accounts_type_check;
alter table accounts add constraint accounts_type_check
  check (type in ('corrente','poupanca','dinheiro','investimento'));
