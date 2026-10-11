-- ============================================================
-- MIGRAÇÃO — categorias individuais (cada login tem as suas)
-- Rode UMA vez em: Supabase Dashboard > SQL Editor > New query
--
-- O que faz:
-- 1) adiciona o dono (user_id) em "categories";
-- 2) dá a CADA usuário uma cópia de todas as categorias que eram
--    compartilhadas, e repontua os lançamentos e fixos dele pra cópia
--    (ninguém perde categoria em lançamento nenhum);
-- 3) apaga as compartilhadas e troca a política: cada login só vê,
--    cria, edita e exclui as próprias categorias.
-- Usuários novos ganham as categorias padrão pelo próprio app no
-- primeiro acesso. Rodar de novo não duplica nada.
-- ============================================================

begin;

alter table categories add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table categories alter column user_id set default auth.uid();

do $$
declare
  u record;
  c record;
  new_id uuid;
begin
  for u in select id from auth.users loop
    for c in select * from categories where user_id is null loop
      insert into categories (name, kind, color, created_at, user_id)
      values (c.name, c.kind, c.color, c.created_at, u.id)
      returning id into new_id;

      update transactions set category_id = new_id
        where category_id = c.id and created_by = u.id;
      update recurring_expenses set category_id = new_id
        where category_id = c.id and created_by = u.id;
    end loop;
  end loop;
end $$;

delete from categories where user_id is null;
alter table categories alter column user_id set not null;

-- junta categorias repetidas do mesmo usuário (mesmo tipo e nome),
-- mantendo a mais antiga e repontuando o que usava as outras
with d as (
  select id, first_value(id) over (partition by user_id, kind, lower(name) order by created_at, id) as keep
  from categories
)
update transactions t set category_id = d.keep from d where t.category_id = d.id and d.id <> d.keep;

with d as (
  select id, first_value(id) over (partition by user_id, kind, lower(name) order by created_at, id) as keep
  from categories
)
update recurring_expenses r set category_id = d.keep from d where r.category_id = d.id and d.id <> d.keep;

with d as (
  select id, first_value(id) over (partition by user_id, kind, lower(name) order by created_at, id) as keep
  from categories
)
delete from categories c using d where c.id = d.id and d.id <> d.keep;

-- não deixa o mesmo usuário ter duas categorias iguais do mesmo tipo
create unique index if not exists categories_user_kind_name
  on categories (user_id, kind, lower(name));

drop policy if exists "auth full access" on categories;
drop policy if exists "dono ve e edita suas categorias" on categories;
create policy "dono ve e edita suas categorias" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
