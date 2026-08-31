-- ============================================================
-- MIGRAÇÃO — de "financeiro compartilhado" para "financeiro individual"
-- Rode este script SÓ se você já tinha o projeto Supabase configurado
-- com o schema.sql antigo (se está criando o projeto do zero, não
-- precisa disso: use o schema.sql atual, que já vem assim).
--
-- O que muda: cada login passa a ver e editar só as próprias contas,
-- despesas fixas e lançamentos. As categorias continuam compartilhadas
-- (é só uma lista de referência, sem valores).
--
-- Rode em: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- 1) Adiciona a coluna de dono em "accounts" (ela não existia antes)
alter table accounts add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2) Define o dono das contas já cadastradas.
-- Escolha UMA das opções abaixo (descomente as linhas) antes de continuar.
-- Se pular esta etapa, o passo 5 vai falhar porque vai sobrar conta sem dono.

-- Opção A — atribuir TODAS as contas existentes a um e-mail específico
-- (troque 'seu-email@exemplo.com' pelo e-mail de login de quem deve ficar com elas):
-- update accounts set user_id = (select id from auth.users where email = 'seu-email@exemplo.com')
-- where user_id is null;

-- Opção B — atribuir cada conta a quem mais lançou nela até hoje (heurística automática):
-- update accounts a set user_id = (
--   select t.created_by from transactions t
--   where t.account_id = a.id
--   group by t.created_by
--   order by count(*) desc
--   limit 1
-- )
-- where user_id is null;

-- 3) Preenche "created_by" de lançamentos/despesas fixas antigos que porventura
-- estejam sem dono (linhas criadas antes desse campo existir, se houver).
-- Ajuste o e-mail para a pessoa responsável por esses registros antigos:
-- update transactions set created_by = (select id from auth.users where email = 'seu-email@exemplo.com')
-- where created_by is null;
-- update recurring_expenses set created_by = (select id from auth.users where email = 'seu-email@exemplo.com')
-- where created_by is null;

-- 4) Confere se sobrou algo sem dono antes de travar as colunas como NOT NULL
-- (se qualquer um destes SELECTs retornar linhas, volte no passo 2/3 e resolva antes de seguir):
-- select * from accounts where user_id is null;
-- select * from transactions where created_by is null;
-- select * from recurring_expenses where created_by is null;

-- 5) Trava as colunas como obrigatórias, com fallback automático para novas linhas
alter table accounts alter column user_id set not null;
alter table accounts alter column user_id set default auth.uid();

alter table transactions alter column created_by set not null;
alter table transactions alter column created_by set default auth.uid();

alter table recurring_expenses alter column created_by set not null;
alter table recurring_expenses alter column created_by set default auth.uid();

-- 6) Troca as políticas de acesso: de "todo autenticado vê tudo" para "só o dono vê"
drop policy if exists "auth full access" on accounts;
drop policy if exists "auth full access" on recurring_expenses;
drop policy if exists "auth full access" on transactions;

create policy "dono ve e edita suas contas" on accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dono ve e edita suas despesas fixas" on recurring_expenses
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "dono ve e edita seus lancamentos" on transactions
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- Categorias continuam com a política antiga (lista compartilhada) — nada a fazer nelas.
