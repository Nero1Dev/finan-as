# Minhas Finanças

Site de controle financeiro pessoal com a identidade visual de nairondalmaso.com.br.
Os dados ficam salvos na nuvem (Supabase), então funcionam em qualquer navegador ou
dispositivo em que você fizer login — não dependem do navegador local.

## O que tem

- Login por e-mail/senha (até você + 1 pessoa)
- Contas e cartões múltiplos, com saldo por conta
- Lançamento de receitas e despesas
- Despesas parceladas (ex: "Notebook, 10x") — gera as parcelas automaticamente
- Despesas fixas mensais (ex: aluguel, internet) — geram o lançamento do mês
  automaticamente sempre que você abre o app naquele mês, já marcado como
  **PENDENTE** (só entra no saldo quando você clica no selo e marca como PAGO)
- Botão "+" em qualquer lançamento avulso (não parcelado, não fixo) para somar
  valor a ele — útil pra despesas que crescem ao longo do dia, tipo churrasco

## 1. Criar o projeto no Supabase (grátis)

1. Acesse https://supabase.com e crie uma conta / projeto novo.
2. No painel do projeto, vá em **SQL Editor** → **New query**.
3. Copie todo o conteúdo do arquivo `sql/schema.sql` deste projeto, cole lá e clique em **Run**.
   Isso cria as tabelas, as regras de segurança e as categorias padrão.
4. Vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon public key**
5. Abra `js/supabaseClient.js` neste projeto e cole os dois valores no lugar de
   `COLE_AQUI_SUA_SUPABASE_URL` e `COLE_AQUI_SUA_SUPABASE_ANON_KEY`.

## 2. Criar as contas de login (você + a segunda pessoa)

Você tem duas opções:

**Opção A — pelo próprio site:** abra `index.html`, clique em "Criar uma conta" e
cadastre seu e-mail/senha. Repita para a segunda pessoa.

**Opção B — pelo painel Supabase:** Authentication → Users → Add user, e crie os
dois logins direto por lá (mais controle, não passa pela tela pública).

Depois de criar as 2 contas, vá em **Authentication → Sign In / Providers** e
desative **"Allow new users to sign up"**, para que mais ninguém consiga se
cadastrar sozinho. Os dois logins que já existem continuam funcionando normalmente.

Por padrão o Supabase pode exigir confirmação por e-mail no cadastro — se preferir
pular isso (útil pra só vocês dois usarem), em **Authentication → Providers → Email**
desative "Confirm email".

## 3. Testar localmente

Como é um site estático (HTML/CSS/JS puro, sem build), basta abrir com um servidor
local simples — não abra o `index.html` direto com duplo clique (módulos JS não
funcionam via `file://`). No terminal, dentro da pasta do projeto:

```
npx serve .
```

ou, se tiver Python:

```
python -m http.server 8000
```

Depois acesse `http://localhost:8000` (ou a porta que aparecer).

## 4. Publicar (hospedar) o site

Como é tudo estático, pode subir em qualquer hospedagem que sirva arquivos HTML —
inclusive o mesmo lugar onde está hospedado o nairondalmaso.com.br. Alternativas
gratuitas e simples: Vercel, Netlify, Cloudflare Pages ou GitHub Pages — basta
arrastar a pasta do projeto.

## Estrutura

```
index.html        → tela de login
app.html           → painel principal (lançamentos, contas, fixas)
css/style.css       → identidade visual (cores, fontes)
js/supabaseClient.js → configuração de conexão com o Supabase (preencher)
js/auth.js          → lógica de login/cadastro
js/app.js           → lógica do painel (CRUD, saldo, parcelas, fixas)
sql/schema.sql       → script para criar o banco de dados no Supabase
```

## Observação sobre "compartilhado"

Como você disse que serão no máximo 2 pessoas usando, o modelo aqui é de
**financeiro compartilhado**: qualquer um dos 2 logins vê e edita as mesmas contas
e lançamentos (não é uma área separada por pessoa). Se depois você preferir que
cada um veja só o que lançou, é uma mudança pontual nas regras de segurança do
banco — é só pedir.
