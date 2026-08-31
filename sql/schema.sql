-- ============================================================
-- FINANÇAS — Schema Supabase
-- Rode este script inteiro em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- Contas e cartões
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('corrente','poupanca','cartao','dinheiro','investimento')),
  color text default '#C99A44',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Categorias
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('receita','despesa')),
  color text default '#7C3220',
  created_at timestamptz not null default now()
);

-- Despesas fixas mensais (modelo — gera lançamentos em "transactions")
create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(12,2) not null,
  account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  day_of_month int not null check (day_of_month between 1 and 28),
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Lançamentos: receitas, despesas avulsas, parcelas e ocorrências de despesas fixas
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(12,2) not null,
  kind text not null check (kind in ('receita','despesa')),
  date date not null,
  account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  installment_number int,
  installment_total int,
  installment_group uuid,
  recurring_id uuid references recurring_expenses(id) on delete set null,
  recurring_month text,
  paid boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (recurring_id, recurring_month)
);

create index if not exists idx_transactions_date on transactions(date);
create index if not exists idx_transactions_account on transactions(account_id);
create index if not exists idx_transactions_group on transactions(installment_group);

-- ============================================================
-- RLS — só usuários autenticados (você + a segunda pessoa) acessam,
-- e todos veem os mesmos dados (financeiro compartilhado).
-- IMPORTANTE: depois de criar as 2 contas, vá em Authentication > Providers
-- e desative "Allow new users to sign up" para ninguém mais se cadastrar.
-- ============================================================

alter table accounts enable row level security;
alter table categories enable row level security;
alter table recurring_expenses enable row level security;
alter table transactions enable row level security;

create policy "auth full access" on accounts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth full access" on categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth full access" on recurring_expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth full access" on transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Categorias padrão
insert into categories (name, kind, color) values
  ('Salário', 'receita', '#C99A44'),
  ('Freelance / Extra', 'receita', '#C99A44'),
  ('Outras receitas', 'receita', '#C99A44'),
  ('Moradia', 'despesa', '#7C3220'),
  ('Alimentação', 'despesa', '#7C3220'),
  ('Transporte', 'despesa', '#7C3220'),
  ('Saúde', 'despesa', '#7C3220'),
  ('Lazer', 'despesa', '#7C3220'),
  ('Assinaturas', 'despesa', '#7C3220'),
  ('Cartão de crédito', 'despesa', '#7C3220'),
  ('Outras despesas', 'despesa', '#7C3220')
on conflict do nothing;
