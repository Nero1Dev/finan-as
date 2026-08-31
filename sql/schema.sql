-- ============================================================
-- FINANÇAS — Schema Supabase
-- Rode este script inteiro em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- Contas (cada uma pertence a um único login). Cartão de crédito NÃO é uma
-- conta com saldo — veja as tabelas "cards" e "invoices" mais abaixo.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('corrente','poupanca','dinheiro','investimento')),
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

-- Cartões de crédito (não têm saldo — geram faturas mensais)
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

-- Faturas do cartão (uma por ciclo mensal). Total/status são calculados
-- a partir das compras (transactions) vinculadas — não ficam guardados
-- aqui, pra nunca dessincronizar.
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
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
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
  card_id uuid references cards(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  paid boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_id, recurring_month)
);

create index if not exists idx_transactions_date on transactions(date);
create index if not exists idx_transactions_account on transactions(account_id);
create index if not exists idx_transactions_group on transactions(installment_group);
create index if not exists idx_transactions_invoice on transactions(invoice_id);

-- ============================================================
-- RLS — só usuários autenticados (você + a segunda pessoa) acessam.
-- Cada login só vê e edita suas PRÓPRIAS contas, despesas fixas e
-- lançamentos (financeiro individual, não compartilhado). As categorias
-- continuam sendo uma lista de referência única, usada pelos dois.
-- IMPORTANTE: depois de criar as 2 contas, vá em Authentication > Providers
-- e desative "Allow new users to sign up" para ninguém mais se cadastrar.
-- ============================================================

alter table accounts enable row level security;
alter table categories enable row level security;
alter table cards enable row level security;
alter table invoices enable row level security;
alter table recurring_expenses enable row level security;
alter table transactions enable row level security;

create policy "auth full access" on categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "dono ve e edita suas contas" on accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dono ve e edita seus cartoes" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dono ve e edita suas faturas" on invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dono ve e edita suas despesas fixas" on recurring_expenses
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "dono ve e edita seus lancamentos" on transactions
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- Categorias padrão
-- Perfis (associa um nome de usuário único a cada login, permite
-- entrar tanto com e-mail quanto com nome de usuário)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  email text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "leitura publica para login por usuario" on profiles
  for select using (true);

create policy "usuario cria proprio perfil" on profiles
  for insert with check (auth.uid() = id);

create policy "usuario atualiza proprio perfil" on profiles
  for update using (auth.uid() = id);

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
