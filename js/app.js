import { supabase } from "./supabaseClient.js";
import { ensureProfile } from "./profile.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MONTHS_LONG = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ---------- ÍCONES ----------
// os símbolos ficam no sprite do app.html (#i-<nome>)
function icon(name, cls = "") {
  return `<svg class="i${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// ícone de cada categoria, pelo nome (a ordem importa: a primeira regra que bate vence)
const CATEGORY_ICONS = [
  [/restaur|lanche|ifood|delivery|comida|pizza/, "fork"],
  [/mercad|aliment|feira|padaria|acougue|hortifruti/, "cart"],
  [/transp|uber|combust|gasolin|carro|onibus|metro|estacion|pedagio|moto/, "car"],
  [/luz|energia|eletrica|contas/, "bolt"],
  [/morad|aluguel|casa|condom|iptu/, "home"],
  [/agua|saneamento/, "drop"],
  [/internet|wifi/, "wifi"],
  [/celular|telefon/, "phone"],
  [/academia|esporte|gym/, "dumbbell"],
  [/saude|farmac|medic|hospital|dentist/, "heart"],
  [/lazer|stream|cinema|assinatura|diversao|jogo/, "film"],
  [/educa|curso|escola|faculdade|livro/, "book"],
  [/viage|turismo|hotel|passage/, "plane"],
  [/roupa|vestu|moda|calcado/, "shirt"],
  [/pet|cachorro|gato|veterin|racao/, "paw"],
  [/presente|doac/, "gift"],
  [/eletron|tecnolog|notebook|computador/, "laptop"],
  [/imposto|taxa|juros|tarifa|multa/, "percent"],
  [/cartao/, "card"],
  [/salario|trabalho|freela|servico|labore/, "briefcase"],
  [/invest|rendimento|dividend|poupanc/, "trend"],
  [/reembolso|estorno|devoluc/, "undo"],
  [/vend/, "tag"],
];
function normalizeText(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function categoryIcon(name, kind) {
  const n = normalizeText(name);
  for (const [re, ic] of CATEGORY_ICONS) if (re.test(n)) return ic;
  return kind === "receita" ? "in" : "tag";
}
const ACCOUNT_ICONS = { corrente: "bank", poupanca: "piggy", dinheiro: "cash", investimento: "trend" };
const CARD_COLORS = ["#6D3BE0", "#B84A0C", "#1D5FB8", "#0F7A50", "#A8325F", "#3A3270"];
function cardColor(card) {
  const i = Math.max(0, allCards.findIndex((c) => c.id === card?.id));
  return CARD_COLORS[i % CARD_COLORS.length];
}

// ---------- ERROS / TOAST ----------
async function mutate(promiseBuilder) {
  const { data, error } = await promiseBuilder;
  if (error) {
    console.error(error);
    showToast("Não foi possível salvar: " + (error.message || "erro desconhecido"));
  }
  return { data, error };
}

function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

// ---------- MÁSCARA DE VALOR (R$) ----------
// formata como o usuário digita: dígitos são lidos da direita pra esquerda
// (últimos 2 = centavos), com "." de milhar e "," decimal, tipo maquininha
function formatMoney(cents) {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyInputToNumber(input) {
  const digits = input.value.replace(/\D/g, "");
  return digits ? Number(digits) / 100 : 0;
}

function setMoneyInput(input, amount) {
  input.value = amount === null || amount === undefined || amount === "" ? "" : formatMoney(Math.round(Number(amount) * 100));
}

document.querySelectorAll(".money-input").forEach((input) => {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "");
    input.value = digits ? formatMoney(Number(digits)) : "";
  });
});

let user = null;
let accounts = [];
let categories = [];
let recurring = [];
let recurringSkips = [];
let cards = []; // só os ativos
let allCards = []; // inclui arquivados (pra rotular faturas/compras antigas)
let invoices = [];
let cardTransactions = []; // todos os lançamentos vinculados a algum cartão, de qualquer mês
let invoicePayments = []; // lançamentos que pagam fatura (pays_invoice_id)
let transactions = []; // do mês atual
let viewDate = new Date(); // dia 1 = mês em foco
viewDate.setDate(1);

// ---------- BOOT ----------
init();

async function init() {
  try {
    await boot();
  } catch (err) {
    // nunca deixa a tela presa no "carregando": mostra o erro e um jeito de sair
    console.error(err);
    const veil = document.getElementById("loadingVeil");
    veil.innerHTML = `
      <span class="brand-mark">${icon("alert")}</span>
      <span class="mono">NÃO FOI POSSÍVEL CARREGAR</span>
      <button class="btn btn-primary" onclick="location.reload()">Tentar de novo</button>`;
  }
}

async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/"; return; }
  user = session.user;
  await ensureProfile(user);
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
  const displayName = profile?.username || user.email;
  document.getElementById("userLabel").textContent = displayName;
  document.getElementById("userAvatar").textContent = displayName.charAt(0);

  await loadStaticData();
  if (await ensureRecurringForVisibleMonth()) await loadStaticData();
  await loadMonthTransactions();
  renderAll();

  document.getElementById("loadingVeil").style.display = "none";
}

for (const id of ["logoutBtn", "logoutBtnMobile"]) {
  document.getElementById(id).addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  });
}

// ---------- DATA LOADING ----------
async function loadStaticData() {
  const [accRes, catRes, recRes, skipRes, cardRes, invRes, cardTxRes, payRes] = await Promise.all([
    supabase.from("accounts").select("*").eq("archived", false).order("created_at"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("recurring_expenses").select("*").order("created_at"),
    supabase.from("recurring_skips").select("*"),
    supabase.from("cards").select("*").order("created_at"),
    supabase.from("invoices").select("*"),
    supabase.from("transactions").select("*").not("card_id", "is", null),
    supabase.from("transactions").select("*").not("pays_invoice_id", "is", null),
  ]);
  accounts = accRes.data || [];
  categories = catRes.data || [];
  recurring = recRes.data || [];
  recurringSkips = skipRes.data || [];
  allCards = cardRes.data || [];
  cards = allCards.filter((c) => !c.archived);
  invoices = invRes.data || [];
  cardTransactions = cardTxRes.data || [];
  invoicePayments = payRes.data || [];
}

function monthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

// data local (não UTC): à noite no Brasil o toISOString já virava o dia seguinte
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadMonthTransactions() {
  const { start, end } = monthBounds(viewDate);
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .gte("date", toISODate(start))
    .lte("date", toISODate(end))
    .order("date", { ascending: false });
  transactions = data || [];
}

async function loadAllTransactionsForBalance() {
  const { data } = await supabase.from("transactions").select("account_id,kind,amount,paid,date,card_id");
  return data || [];
}

function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

// gera as ocorrências das despesas fixas do mês em foco. As que são no
// cartão viram compras na fatura do ciclo; pra elas também gera o mês
// anterior, porque a ocorrência dele cai na fatura que vence neste mês.
// Retorna true se gerou compra no cartão (aí as faturas precisam recarregar).
async function ensureRecurringForVisibleMonth() {
  const year = viewDate.getFullYear();
  const month0 = viewDate.getMonth();
  const months = [
    { year, month0, cardOnly: false },
    { ...shiftMonth(year, month0, -1), cardOnly: true },
  ];
  const rows = [];
  let cardRows = 0;
  for (const m of months) {
    const start = new Date(m.year, m.month0, 1);
    const end = new Date(m.year, m.month0 + 1, 0);
    const recurringMonth = referenceMonthKey(m.year, m.month0);
    for (const r of recurring) {
      if (!r.active) continue;
      const kind = r.kind || "despesa";
      if (m.cardOnly && !(kind === "despesa" && r.card_id)) continue;
      if (!(new Date(r.start_date) <= end && (!r.end_date || new Date(r.end_date) >= start))) continue;
      if (recurringSkips.some((s) => s.recurring_id === r.id && s.month === recurringMonth)) continue;
      const day = Math.min(r.day_of_month, daysInMonth(m.year, m.month0));
      const date = new Date(m.year, m.month0, day);
      const base = {
        description: r.description,
        amount: r.amount,
        kind,
        date: toISODate(date),
        category_id: r.category_id,
        recurring_id: r.id,
        recurring_month: recurringMonth,
        // receita entra no saldo pela data; despesa de conta começa PENDENTE
        paid: kind === "receita",
        created_by: user.id,
      };
      if (kind === "despesa" && r.card_id) {
        if (cardTransactions.some((t) => t.recurring_id === r.id && t.recurring_month === recurringMonth)) continue;
        const card = cardById(r.card_id);
        if (!card) continue;
        const ref = invoiceReferenceMonth(date, card.closing_day);
        const inv = await ensureInvoice(card, ref.year, ref.month0);
        if (!inv) continue;
        rows.push({ ...base, account_id: null, card_id: card.id, invoice_id: inv.id });
        cardRows++;
      } else {
        rows.push({ ...base, account_id: r.account_id });
      }
    }
  }

  if (rows.length === 0) return false;
  await mutate(supabase.from("transactions").upsert(rows, { onConflict: "recurring_id,recurring_month", ignoreDuplicates: true }));
  return cardRows > 0;
}

// ---------- RENDER ----------
function renderAll() {
  renderSummary();
  renderMonthLabel();
  renderTxList();
  renderCategoryBars();
  renderReport();
  renderUpcoming();
  renderAccountsGrid();
  renderCardsGrid();
  renderRecurringGrid();
  renderCategoriesPage();
  fillSelects();
}

let accountBalances = {}; // saldo de cada conta hoje (preenchido pelo resumo)

async function renderSummary() {
  const all = await loadAllTransactionsForBalance();
  const now = new Date();
  const todayISO = toISODate(now);
  const balanceByAccount = {};
  let total = 0;
  const counted = []; // { date, v } de tudo que já mexeu no saldo
  for (const a of accounts) balanceByAccount[a.id] = 0;
  for (const t of all) {
    if (t.card_id) continue; // compra no cartão não mexe no saldo; o pagamento da fatura sim
    if (t.kind === "despesa" && !t.paid) continue; // pendente ainda não saiu da conta
    if (t.kind === "receita" && t.date > todayISO) continue; // ainda não caiu na conta
    const v = Number(t.amount) * (t.kind === "receita" ? 1 : -1);
    if (t.account_id in balanceByAccount) balanceByAccount[t.account_id] += v;
    total += v;
    counted.push({ date: t.date, v });
  }
  accountBalances = balanceByAccount;

  // a pagar: despesas de conta pendentes + faturas que vencem no mês
  const accExpenses = transactions.filter((t) => t.kind === "despesa" && !t.card_id && !t.pays_invoice_id && !t.carryover);
  const dueInvoices = invoicesDueInMonth(viewDate);
  const unpaidInvoices = dueInvoices.filter((x) => x.info.status !== "PAGA");
  const pendingThisMonth = sumAmounts(accExpenses.filter((t) => !t.paid))
    + unpaidInvoices.reduce((sum, x) => sum + Math.max(x.info.remaining, 0), 0);
  const paidThisMonth = sumAmounts(accExpenses.filter((t) => t.paid))
    + dueInvoices.reduce((sum, x) => sum + Math.max(Math.min(x.info.paid, x.info.total), 0), 0);
  const pendingCount = accExpenses.filter((t) => !t.paid).length + unpaidInvoices.length;

  const incomes = transactions.filter((t) => t.kind === "receita");
  const receivableThisMonth = sumAmounts(incomes.filter((t) => t.date > todayISO));
  const receivedThisMonth = sumAmounts(incomes.filter((t) => t.date <= todayISO));
  const receivableCount = incomes.filter((t) => t.date > todayISO).length;

  // ----- saldo em destaque
  document.getElementById("heroValue").textContent = currency.format(total);

  // comparação com o saldo no fim do mês passado (pela data dos lançamentos)
  const prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevTotal = counted.filter((c) => c.date <= toISODate(prevEndDate)).reduce((s, c) => s + c.v, 0);
  const diff = round2(total - prevTotal);
  const prevLabel = MONTHS_SHORT[prevEndDate.getMonth()].toLowerCase();
  const trendEl = document.getElementById("heroTrend");
  if (Math.abs(diff) < 0.005) {
    trendEl.innerHTML = `<span class="trend flat">= ${prevLabel}</span>`;
  } else {
    const pct = Math.abs(prevTotal) > 0.005 ? Math.round((diff / Math.abs(prevTotal)) * 100) : null;
    const text = pct !== null && Math.abs(pct) < 1000
      ? `${diff > 0 ? "+" : "−"}${Math.abs(pct)}% vs ${prevLabel}`
      : `${diff > 0 ? "+" : "−"}${currency.format(Math.abs(diff))} vs ${prevLabel}`;
    trendEl.innerHTML = `<span class="trend ${diff > 0 ? "up" : "down"}" title="Saldo no fim de ${MONTHS_LONG[prevEndDate.getMonth()].toLowerCase()}: ${currency.format(prevTotal)} (diferença de ${currency.format(diff)})">${text}</span>`;
  }

  const isCurrentMonth = viewDate.getFullYear() === now.getFullYear() && viewDate.getMonth() === now.getMonth();
  document.getElementById("heroForecast").innerHTML = isCurrentMonth
    ? `Previsto p/ fim do mês: <strong class="money-sensitive">${currency.format(total + receivableThisMonth - pendingThisMonth)}</strong>`
    : "";
  document.getElementById("heroAccounts").textContent = `${accounts.length} ${accounts.length === 1 ? "conta" : "contas"}`;
  renderSparkline(counted, todayISO);

  // ----- a pagar / a receber
  document.getElementById("payValue").textContent = currency.format(pendingThisMonth);
  const payTotal = pendingThisMonth + paidThisMonth;
  document.getElementById("payBar").style.width = (payTotal > 0 ? (paidThisMonth / payTotal) * 100 : 0) + "%";
  document.getElementById("payFoot").textContent = payTotal > 0
    ? `${currency.format(paidThisMonth)} já pago · ${pendingCount} ${pendingCount === 1 ? "pendente" : "pendentes"}`
    : "Nada a pagar neste mês";

  document.getElementById("recValue").textContent = currency.format(receivableThisMonth);
  const recTotal = receivableThisMonth + receivedThisMonth;
  document.getElementById("recBar").style.width = (recTotal > 0 ? (receivedThisMonth / recTotal) * 100 : 0) + "%";
  document.getElementById("recFoot").textContent = recTotal > 0
    ? `${currency.format(receivedThisMonth)} recebido · ${receivableCount} a receber`
    : "Nenhuma receita neste mês";

  // ----- saldo por conta
  const strip = document.getElementById("accountsStrip");
  strip.innerHTML = accounts.map((a) => {
    const v = balanceByAccount[a.id] || 0;
    return `<div class="acc-chip">
      <span class="acc-ic">${icon(ACCOUNT_ICONS[a.type] || "bank", "sm")}</span>
      <span><span class="acc-name">${escapeHtml(a.name)}</span><br><span class="acc-val money-sensitive${v < 0 ? " neg" : ""}">${currency.format(v)}</span></span>
    </div>`;
  }).join("");
  strip.style.display = accounts.length ? "" : "none";
  renderAccountsGrid();
}

// linha do saldo dia a dia no mês em foco (até hoje, se for o mês atual)
function renderSparkline(counted, todayISO) {
  const svg = document.getElementById("heroSpark");
  const { start, end } = monthBounds(viewDate);
  const startISO = toISODate(start);
  const lastISO = toISODate(end) < todayISO ? toISODate(end) : todayISO;
  if (lastISO < startISO) { svg.innerHTML = ""; return; } // mês futuro: ainda não tem histórico
  let running = counted.filter((c) => c.date < startISO).reduce((s, c) => s + c.v, 0);
  const byDay = {};
  for (const c of counted) if (c.date >= startISO && c.date <= lastISO) byDay[c.date] = (byDay[c.date] || 0) + c.v;
  const points = [];
  for (let d = new Date(start); toISODate(d) <= lastISO; d.setDate(d.getDate() + 1)) {
    running += byDay[toISODate(d)] || 0;
    points.push(running);
  }
  if (points.length === 1) points.unshift(points[0]);
  const W = 600, H = 90, PAD = 8;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const days = daysInMonth(viewDate.getFullYear(), viewDate.getMonth());
  const step = W / Math.max(days - 1, 1);
  const xy = points.map((v, i) => [i * step, PAD + (1 - (v - min) / span) * (H - PAD * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  svg.innerHTML = `
    <path d="${line} L${lx.toFixed(1)} ${H} L0 ${H} Z" style="fill:var(--hero-2)"></path>
    <path d="${line}" fill="none" style="stroke:var(--hero-line)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" fill="#fff"></circle>`;
}

// ocultar valores do resumo (lembra a escolha neste aparelho)
const HIDE_KEY = "financas:hideValues";
function applyHideValues(hide) {
  document.body.classList.toggle("hide-values", hide);
  const btn = document.getElementById("toggleValues");
  btn.innerHTML = icon(hide ? "eye-off" : "eye", "sm");
  btn.setAttribute("aria-label", hide ? "Mostrar valores" : "Ocultar valores");
  btn.title = hide ? "Mostrar valores" : "Ocultar valores";
}
try { applyHideValues(localStorage.getItem(HIDE_KEY) === "1"); } catch { applyHideValues(false); }
document.getElementById("toggleValues").addEventListener("click", () => {
  const hide = !document.body.classList.contains("hide-values");
  try { localStorage.setItem(HIDE_KEY, hide ? "1" : "0"); } catch { /* sem storage, tudo bem */ }
  applyHideValues(hide);
});

function monthTitle(date) { return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`; }

function renderMonthLabel() {
  document.getElementById("monthLabel").textContent = monthTitle(viewDate);
  document.getElementById("txTitle").textContent = `Lançamentos de ${MONTHS_LONG[viewDate.getMonth()].toLowerCase()}`;
}

// ---------- GRÁFICOS (despesas e receitas por categoria) ----------
const CATEGORY_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER_COLOR = "#8a8597";

// cor de cada categoria: as criadas aqui guardam a própria cor; as antigas
// (com a cor padrão do tema velho) recebem a paleta pela ordem do nome
const LEGACY_CATEGORY_COLORS = new Set(["#7c3220", "#c99a44"]);
function hasOwnColor(c) { return !!c.color && !LEGACY_CATEGORY_COLORS.has(c.color.toLowerCase()); }
function categoryColorMap(kind) {
  const map = {};
  categories
    .filter((c) => c.kind === kind && !hasOwnColor(c))
    .forEach((c, i) => { map[c.id] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]; });
  for (const c of categories) if (c.kind === kind && hasOwnColor(c)) map[c.id] = c.color;
  return map;
}

function categoryVisual(categoryId, kind) {
  const cat = categories.find((c) => c.id === categoryId);
  return {
    name: cat?.name || "Sem categoria",
    color: categoryColorMap(cat?.kind || kind)[categoryId] || OTHER_COLOR,
    icon: categoryIcon(cat?.name, cat?.kind || kind),
  };
}

// totais do mês por categoria (top 5 + "Outras"), do maior pro menor
function categoryTotals(kind, txs = transactions) {
  const colorMap = categoryColorMap(kind);
  const totals = {};
  for (const t of txs) {
    if (t.kind !== kind) continue;
    if (t.pays_invoice_id || t.carryover) continue; // as compras já contam; o pagamento contaria duas vezes
    totals[t.category_id] = (totals[t.category_id] || 0) + Number(t.amount);
  }
  let entries = Object.entries(totals)
    .filter(([, amount]) => amount > 0)
    .map(([catId, amount]) => {
      const cat = categories.find((c) => c.id === catId);
      return { name: cat?.name || "Sem categoria", amount, color: colorMap[catId] || OTHER_COLOR, icon: categoryIcon(cat?.name, kind) };
    })
    .sort((a, b) => b.amount - a.amount);
  if (entries.length > 6) {
    const head = entries.slice(0, 5);
    const tailSum = entries.slice(5).reduce((s, e) => s + e.amount, 0);
    entries = [...head, { name: "Outras", amount: tailSum, color: OTHER_COLOR, icon: "dots" }];
  }
  return entries;
}

function renderDonut(prevTxs = null) {
  renderDonutChart("despesa", "donut", prevTxs);
  renderDonutChart("receita", "incomeDonut", prevTxs);
}

// desenha um gráfico de rosca por categoria pro tipo `kind`, nos elementos
// com ids `${prefix}Svg`, `${prefix}Legend`, `${prefix}TotalValue`…
// prevTxs (opcional): lançamentos do mês anterior, pra mostrar a variação de cada categoria
function renderDonutChart(kind, prefix, prevTxs = null) {
  const svg = document.getElementById(prefix + "Svg");
  const legend = document.getElementById(prefix + "Legend");
  const totalEl = document.getElementById(prefix + "TotalValue");
  const empty = document.getElementById(prefix + "Empty");
  const layout = document.getElementById(prefix + "Layout");
  if (!svg) return;

  const entries = categoryTotals(kind);
  const prevMap = prevTxs ? categoryAmountsByName(kind, prevTxs) : {};
  svg.innerHTML = "";
  legend.innerHTML = "";

  if (entries.length === 0) {
    layout.style.display = "none";
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";
  layout.style.display = "";

  const total = entries.reduce((s, e) => s + e.amount, 0);
  totalEl.textContent = currency.format(total);

  const R = 70, CX = 90, CY = 90, C = 2 * Math.PI * R, GAP = 3, SW = 22;
  const ns = "http://www.w3.org/2000/svg";
  let offset = 0;
  let cumFrac = 0;
  for (const e of entries) {
    const frac = e.amount / total;
    const len = frac * C;
    const dash = Math.max(len - GAP, 0.001);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", CX);
    circle.setAttribute("cy", CY);
    circle.setAttribute("r", R);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", e.color);
    circle.setAttribute("stroke-width", SW);
    circle.setAttribute("stroke-dasharray", `${dash} ${C - dash}`);
    circle.setAttribute("stroke-dashoffset", `${-offset}`);
    circle.setAttribute("transform", `rotate(-90 ${CX} ${CY})`);
    circle.setAttribute("class", "donut-seg");
    circle.setAttribute("pointer-events", "none");
    svg.appendChild(circle);
    offset += len;
    e.startAngle = cumFrac * 360;
    cumFrac += frac;
    e.endAngle = cumFrac * 360;
    e.pct = (frac * 100).toFixed(1);
  }

  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const dx = ev.clientX - (rect.left + rect.width / 2);
    const dy = ev.clientY - (rect.top + rect.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const scale = rect.width / 180;
    const inner = (R - SW / 2) * scale, outer = (R + SW / 2) * scale;
    if (dist < inner || dist > outer) { hideDonutTooltip(); return; }
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const hit = entries.find((e) => angle >= e.startAngle && angle < e.endAngle);
    if (!hit) { hideDonutTooltip(); return; }
    showDonutTooltip(ev, hit.name, hit.amount, hit.pct);
  };
  svg.onmouseleave = hideDonutTooltip;

  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `
      <span class="swatch" style="background:${e.color}"></span>
      <span class="legend-name">${escapeHtml(e.name)}</span>
      <span class="legend-pct">${e.pct}%</span>
      <span class="legend-amount">${currency.format(e.amount)}</span>
      ${prevTxs && e.name !== "Outras" ? deltaHtml(e.amount, prevMap[e.name] || 0, kind === "receita", true) : prevTxs ? "<span></span>" : ""}`;
    legend.appendChild(row);
  }
}

function showDonutTooltip(ev, name, amount, pct) {
  const tip = document.getElementById("donutTooltip");
  tip.innerHTML = `<div class="tt-name">${escapeHtml(name)}</div>${pct}% · ${currency.format(amount)}`;
  tip.style.left = ev.clientX + 14 + "px";
  tip.style.top = ev.clientY + 14 + "px";
  tip.classList.add("show");
}
function hideDonutTooltip() {
  document.getElementById("donutTooltip").classList.remove("show");
}

// barras "para onde foi o dinheiro" do painel inicial
let catKind = "despesa";
function renderCategoryBars() {
  const entries = categoryTotals(catKind);
  const stack = document.getElementById("catStack");
  const rows = document.getElementById("catRows");
  if (entries.length === 0) {
    stack.style.display = "none";
    rows.innerHTML = `<div class="empty-state small">${catKind === "despesa" ? "Nenhuma despesa" : "Nenhuma receita"} neste mês ainda.</div>`;
    return;
  }
  const total = entries.reduce((s, e) => s + e.amount, 0);
  stack.style.display = "";
  stack.innerHTML = entries.map((e) => `<span style="flex:${e.amount};background:${e.color}" title="${escapeHtml(e.name)}"></span>`).join("");
  rows.innerHTML = entries.map((e) => `
    <div class="cat-row">
      <span class="cat-chip" style="background:${e.color}">${icon(e.icon, "sm")}</span>
      <span class="cat-name">${escapeHtml(e.name)}</span>
      <span class="cat-pct">${Math.round((e.amount / total) * 100)}%</span>
      <span class="cat-val">${currency.format(e.amount)}</span>
    </div>`).join("");
}
document.querySelectorAll("#catToggle [data-kind]").forEach((b) => b.addEventListener("click", () => {
  catKind = b.dataset.kind;
  document.querySelectorAll("#catToggle [data-kind]").forEach((x) => x.classList.toggle("active", x === b));
  renderCategoryBars();
}));

// ---------- RELATÓRIO FINANCEIRO ----------
// junta os últimos 6 meses (até o mês em foco) numa consulta só e monta o
// relatório: indicadores, resumo em texto, evolução, categorias, contas e
// cartões, tipo de gasto e maiores despesas. Compra no cartão conta pela
// data da compra (o pagamento da fatura não entra, senão contaria duas vezes).
const INC_COLOR = "#199E70";
const EXP_COLOR = "#E0533D";
const KIND_COLORS = { fixo: "#3987e5", parcelado: "#d95926", avulso: "#199e70" };
let reportData = null;
let reportSeq = 0;

function isReportExpense(t) { return t.kind === "despesa" && !t.pays_invoice_id && !t.carryover; }
function monthShortTitle(d) { const m = MONTHS_SHORT[d.getMonth()]; return m.charAt(0) + m.slice(1).toLowerCase(); }

function categoryAmountsByName(kind, txs) {
  const map = {};
  for (const t of txs) {
    if (t.kind !== kind || t.pays_invoice_id || t.carryover) continue;
    const name = categories.find((c) => c.id === t.category_id)?.name || "Sem categoria";
    map[name] = (map[name] || 0) + Number(t.amount);
  }
  return map;
}

// variação contra o mês anterior, com seta + texto (nunca só cor)
function deltaHtml(cur, prev, goodWhenUp, compact = false) {
  if (!prev && !cur) return compact ? "<span></span>" : "";
  if (!prev) return `<span class="delta neutral">novo</span>`;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return `<span class="delta neutral">= </span>`;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return `<span class="delta ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

function compactMoney(v) {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v)}`;
}

async function renderReport() {
  const seq = ++reportSeq;
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth() - 5, 1);
  const { end } = monthBounds(viewDate);
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .gte("date", toISODate(first))
    .lte("date", toISODate(end));
  if (seq !== reportSeq) return; // trocou de mês no meio: vale a consulta mais nova
  if (error) { console.error(error); return; }
  const rows = data || [];
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const key = referenceMonthKey(d.getFullYear(), d.getMonth());
    const txs = rows.filter((t) => t.date.slice(0, 7) === key);
    months.push({
      key, date: d, label: monthShortTitle(d), txs,
      inc: sumAmounts(txs.filter((t) => t.kind === "receita")),
      exp: sumAmounts(txs.filter(isReportExpense)),
    });
  }
  reportData = { months };
  drawReport();
}

function drawReport() {
  if (!reportData) return;
  const { months } = reportData;
  const cur = months[5], prev = months[4];
  document.getElementById("reportPeriod").textContent =
    `${monthTitle(cur.date)} · comparado com ${MONTHS_LONG[prev.date.getMonth()].toLowerCase()}`;
  renderKpis(cur, prev);
  renderInsights(cur, prev, months);
  drawTrendChart(months);
  renderTrendTable(months);
  renderDonut(prev.txs);
  renderByPay(cur);
  renderKinds(cur);
  renderTopExpenses(cur);
}

function renderKpis(cur, prev) {
  const result = round2(cur.inc - cur.exp);
  const prevResult = round2(prev.inc - prev.exp);
  const rate = cur.inc > 0 ? Math.round((result / cur.inc) * 100) : null;
  const now = new Date();
  const isCurrent = cur.date.getFullYear() === now.getFullYear() && cur.date.getMonth() === now.getMonth();
  const days = isCurrent ? now.getDate() : daysInMonth(cur.date.getFullYear(), cur.date.getMonth());
  const endISO = toISODate(monthBounds(cur.date).end);
  const futureInstallments = sumAmounts(cardTransactions.filter((t) => {
    if (!t.installment_total) return false;
    const inv = invoices.find((i) => i.id === t.invoice_id);
    return inv && inv.due_date > endISO;
  }));
  const prevLabel = MONTHS_SHORT[prev.date.getMonth()].toLowerCase();
  const tile = (label, ic, tone, value, sub) => `
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-ic ${tone}">${icon(ic, "sm")}</span>${label}</div>
      <div class="kpi-value ${tone === "exp" || tone === "inc" ? tone : ""}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  document.getElementById("reportKpis").innerHTML = [
    tile("Receitas", "in", "inc", currency.format(cur.inc), `${deltaHtml(cur.inc, prev.inc, true)} vs ${prevLabel}`),
    tile("Despesas", "out", "exp", currency.format(cur.exp), `${deltaHtml(cur.exp, prev.exp, false)} vs ${prevLabel}`),
    tile("Resultado", "wallet", result >= 0 ? "inc" : "exp", `${result < 0 ? "− " : ""}${currency.format(Math.abs(result))}`,
      `${result >= 0 ? "sobrou" : "faltou"} · ${prevResult >= 0 ? "sobrou" : "faltou"} ${currency.format(Math.abs(prevResult))} em ${prevLabel}`),
    tile("Taxa de poupança", "piggy", "acc", rate === null ? "—" : `${rate}%`, "do que entrou e não saiu"),
    tile("Gasto médio por dia", "calendar", "acc", currency.format(days ? cur.exp / days : 0), `em ${days} ${days === 1 ? "dia" : "dias"}`),
    tile("Parcelas a vencer", "card", "acc", currency.format(futureInstallments), "em faturas dos próximos meses"),
  ].join("");
}

function renderInsights(cur, prev, months) {
  const items = [];
  const result = round2(cur.inc - cur.exp);
  const prevName = MONTHS_LONG[prev.date.getMonth()].toLowerCase();
  if (cur.inc || cur.exp) {
    items.push(result >= 0
      ? ["check", "good", `Sobrou <b>${currency.format(result)}</b> no mês${cur.inc > 0 ? ` — ${Math.round((result / cur.inc) * 100)}% do que entrou` : ""}.`]
      : ["alert", "bad", `As despesas passaram as receitas em <b>${currency.format(-result)}</b>.`]);
  }
  if (prev.exp > 0 && cur.exp > 0) {
    const diff = round2(cur.exp - prev.exp);
    const pct = Math.round((Math.abs(diff) / prev.exp) * 100);
    if (pct >= 1) {
      items.push(diff < 0
        ? ["trend", "good", `Você gastou <b>${pct}% menos</b> que em ${prevName} (${currency.format(-diff)} a menos).`]
        : ["out", "bad", `Você gastou <b>${pct}% mais</b> que em ${prevName} (${currency.format(diff)} a mais).`]);
    }
  }
  const curCats = categoryAmountsByName("despesa", cur.txs);
  const prevCats = categoryAmountsByName("despesa", prev.txs);
  const topCat = Object.entries(curCats).sort((a, b) => b[1] - a[1])[0];
  if (topCat && cur.exp > 0) {
    items.push(["pie", "neutral", `Maior categoria de gasto: <b>${escapeHtml(topCat[0])}</b>, com ${Math.round((topCat[1] / cur.exp) * 100)}% das despesas.`]);
  }
  const rises = Object.entries(curCats)
    .map(([name, v]) => [name, round2(v - (prevCats[name] || 0))])
    .filter(([, d]) => d > 0.5)
    .sort((a, b) => b[1] - a[1]);
  if (rises.length && prev.exp > 0) {
    items.push(["out", "bad", `O maior aumento foi em <b>${escapeHtml(rises[0][0])}</b>: ${currency.format(rises[0][1])} a mais que em ${prevName}.`]);
  }
  const past = months.slice(0, 5).filter((m) => m.exp > 0);
  if (past.length >= 2 && cur.exp > 0) {
    const avg = past.reduce((s, m) => s + m.exp, 0) / past.length;
    const pct = Math.round(((cur.exp - avg) / avg) * 100);
    items.push(["chart", pct > 0 ? "bad" : "good",
      `Média de despesas nos ${past.length} meses anteriores: <b>${currency.format(avg)}</b>. Este mês está ${Math.abs(pct)}% ${pct > 0 ? "acima" : "abaixo"} da média.`]);
  }
  const todayISO = toISODate(new Date());
  const unpaid = sumAmounts(cur.txs.filter((t) => t.kind === "despesa" && !t.paid && !t.card_id && !t.pays_invoice_id));
  const toReceive = sumAmounts(cur.txs.filter((t) => t.kind === "receita" && t.date > todayISO));
  if (unpaid > 0 || toReceive > 0) {
    items.push(["clock", "neutral", `Ainda ${unpaid > 0 ? `falta pagar <b>${currency.format(unpaid)}</b> em contas` : "não há contas a pagar"}${toReceive > 0 ? ` e receber <b>${currency.format(toReceive)}</b>` : ""} neste mês (fora as faturas).`]);
  }
  document.getElementById("reportInsights").innerHTML = items.length
    ? items.map(([ic, tone, html]) => `<li><span class="ins-ic ${tone}">${icon(ic, "sm")}</span><span>${html}</span></li>`).join("")
    : `<li class="empty">Sem lançamentos neste mês ainda.</li>`;
}

function niceMax(max) {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  return step * 4;
}

function drawTrendChart(months) {
  const el = document.getElementById("trendChart");
  const W = Math.max(el.clientWidth, 300), H = 240;
  const padL = 64, padR = 8, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const top = niceMax(Math.max(...months.flatMap((m) => [m.inc, m.exp]), 1));
  const y = (v) => padT + plotH * (1 - Math.max(v, 0) / top);
  const groupW = plotW / months.length;
  const barW = Math.max(6, Math.min(28, (groupW - 20) / 2));
  const base = padT + plotH;
  const bar = (x, v, color) => {
    const yy = y(v), h = base - yy;
    if (h <= 0.5) return "";
    const r = Math.min(4, h, barW / 2);
    return `<path d="M${x} ${base} V${yy + r} Q${x} ${yy} ${x + r} ${yy} H${x + barW - r} Q${x + barW} ${yy} ${x + barW} ${yy + r} V${base} Z" fill="${color}"></path>`;
  };
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i, yy = y(v);
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" style="stroke:var(--line)" stroke-width="1"></line>`;
    svg += `<text x="${padL - 10}" y="${yy + 4}" text-anchor="end" class="ax">${compactMoney(v)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = padL + groupW * i + groupW / 2;
    svg += bar(cx - barW - 1, m.inc, INC_COLOR);
    svg += bar(cx + 1, m.exp, EXP_COLOR);
    svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax${i === months.length - 1 ? " cur" : ""}">${m.label}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${padL + groupW * i}" y="${padT}" width="${groupW}" height="${plotH + padB}" fill="transparent"></rect>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas dos últimos 6 meses">${svg}</svg>`;
  el.querySelectorAll(".hit").forEach((r) => {
    const m = months[Number(r.dataset.i)];
    const res = round2(m.inc - m.exp);
    r.addEventListener("mousemove", (ev) => {
      const tip = document.getElementById("donutTooltip");
      tip.innerHTML = `<div class="tt-name">${monthTitle(m.date)}</div>
        <div class="tt-row"><i style="background:${INC_COLOR}"></i>Receitas <b>${currency.format(m.inc)}</b></div>
        <div class="tt-row"><i style="background:${EXP_COLOR}"></i>Despesas <b>${currency.format(m.exp)}</b></div>
        <div class="tt-row">Resultado <b>${res < 0 ? "− " : ""}${currency.format(Math.abs(res))}</b></div>`;
      tip.style.left = ev.clientX + 14 + "px";
      tip.style.top = ev.clientY + 14 + "px";
      tip.classList.add("show");
      r.setAttribute("fill", "color-mix(in srgb, var(--ink) 4%, transparent)");
    });
    r.addEventListener("mouseleave", () => { hideDonutTooltip(); r.setAttribute("fill", "transparent"); });
  });
}

function renderTrendTable(months) {
  document.getElementById("trendTable").innerHTML = `
    <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead>
    <tbody>${months.map((m) => {
      const res = round2(m.inc - m.exp);
      return `<tr><td>${monthTitle(m.date)}</td><td>${currency.format(m.inc)}</td><td>${currency.format(m.exp)}</td>
        <td class="${res < 0 ? "neg" : ""}">${res < 0 ? "− " : ""}${currency.format(Math.abs(res))}</td></tr>`;
    }).join("")}</tbody>`;
}

function renderByPay(cur) {
  const el = document.getElementById("reportByPay");
  const groups = {};
  for (const t of cur.txs.filter(isReportExpense)) {
    const key = t.card_id ? "card:" + t.card_id : "acc:" + t.account_id;
    if (!groups[key]) {
      if (t.card_id) {
        const card = cardById(t.card_id);
        groups[key] = { name: `Cartão ${card?.name || ""}`.trim(), ic: "card", color: cardColor(card), amount: 0 };
      } else {
        const acc = accounts.find((a) => a.id === t.account_id);
        groups[key] = { name: acc?.name || "Conta arquivada", ic: ACCOUNT_ICONS[acc?.type] || "bank", color: "var(--accent)", amount: 0 };
      }
    }
    groups[key].amount += Number(t.amount);
  }
  const list = Object.values(groups).filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount);
  if (!list.length) { el.innerHTML = `<div class="empty-state small">Nenhuma despesa neste mês.</div>`; return; }
  const total = list.reduce((s, g) => s + g.amount, 0);
  const max = list[0].amount;
  el.innerHTML = list.map((g) => `
    <div class="hbar">
      <span class="hbar-ic" style="--c:${g.color}">${icon(g.ic, "sm")}</span>
      <div class="hbar-main">
        <div class="hbar-top"><span class="hbar-name">${escapeHtml(g.name)}</span><span class="hbar-val">${currency.format(g.amount)} <span class="hbar-pct">${Math.round((g.amount / total) * 100)}%</span></span></div>
        <div class="hbar-track"><span style="width:${(g.amount / max) * 100}%;background:${g.color}"></span></div>
      </div>
    </div>`).join("");
}

function renderKinds(cur) {
  const el = document.getElementById("reportKinds");
  const exps = cur.txs.filter(isReportExpense);
  const parts = [
    { key: "fixo", label: "Fixos", hint: "contas que se repetem todo mês", amount: sumAmounts(exps.filter((t) => t.recurring_id)) },
    { key: "parcelado", label: "Parcelados", hint: "parcelas de compras", amount: sumAmounts(exps.filter((t) => !t.recurring_id && t.installment_total)) },
    { key: "avulso", label: "Avulsos", hint: "gastos do dia a dia", amount: sumAmounts(exps.filter((t) => !t.recurring_id && !t.installment_total)) },
  ];
  const total = parts.reduce((s, p) => s + Math.max(p.amount, 0), 0);
  if (total <= 0) { el.innerHTML = `<div class="empty-state small">Nenhuma despesa neste mês.</div>`; return; }
  el.innerHTML = `
    <div class="cat-stack">${parts.filter((p) => p.amount > 0).map((p) => `<span style="flex:${p.amount};background:${KIND_COLORS[p.key]}" title="${p.label}"></span>`).join("")}</div>
    <div class="cat-rows">${parts.map((p) => `
      <div class="cat-row">
        <span class="swatch-lg" style="background:${KIND_COLORS[p.key]}"></span>
        <span class="cat-name">${p.label} <span class="cat-hint">${p.hint}</span></span>
        <span class="cat-pct">${Math.round((Math.max(p.amount, 0) / total) * 100)}%</span>
        <span class="cat-val">${currency.format(p.amount)}</span>
      </div>`).join("")}
    </div>`;
}

function renderTopExpenses(cur) {
  const el = document.getElementById("reportTop");
  const top = cur.txs.filter(isReportExpense).sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 6);
  if (!top.length) { el.innerHTML = `<div class="empty-state small">Nenhuma despesa neste mês.</div>`; return; }
  el.innerHTML = top.map((t) => {
    const vis = categoryVisual(t.category_id, t.kind);
    const where = t.card_id ? `Cartão ${cardById(t.card_id)?.name || ""}` : accounts.find((a) => a.id === t.account_id)?.name || "—";
    const badge = t.installment_total ? `<span class="badge">${t.installment_number}/${t.installment_total}</span>` : t.recurring_id ? `<span class="badge badge-fixa">Fixa</span>` : "";
    return `<div class="top-row">
      ${txIconHtml(vis.icon, vis.color)}
      <div class="tx-main"><div class="desc">${escapeHtml(t.description)}${badge}</div><div class="meta">${fmtDayMonth(t.date)} · ${escapeHtml(where)} · ${escapeHtml(vis.name)}</div></div>
      <div class="amount">${currency.format(t.amount)}</div>
    </div>`;
  }).join("");
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (reportData) drawTrendChart(reportData.months); }, 150);
});
document.getElementById("printReport").addEventListener("click", () => window.print());

// ---------- CATEGORIAS (criar, editar, excluir) ----------
// a lista é compartilhada entre os logins do app (é só referência, sem valores).
// "Cartão de crédito" fica travada: o pagamento de fatura acha ela pelo nome.
const NEW_CATEGORY = "__new";
const PROTECTED_CATEGORY = "Cartão de crédito";
let categoryFormKind = "despesa";
let categoryFormColor = CATEGORY_PALETTE[0];
let categoryTarget = null; // select que pediu "+ Nova categoria…" (pra já deixar a nova escolhida)

function selectedCategory(id) {
  const v = document.getElementById(id).value;
  return v && v !== NEW_CATEGORY ? v : null;
}

function renderCategoriesPage() {
  const monthTotals = {};
  for (const t of transactions) {
    if (t.pays_invoice_id || t.carryover || !t.category_id) continue;
    monthTotals[t.category_id] = (monthTotals[t.category_id] || 0) + Number(t.amount);
  }
  for (const kind of ["despesa", "receita"]) {
    const suffix = kind === "despesa" ? "Despesa" : "Receita";
    const list = categories.filter((c) => c.kind === kind);
    const colors = categoryColorMap(kind);
    document.getElementById("catCount" + suffix).textContent = `${list.length} ${list.length === 1 ? "categoria" : "categorias"}`;
    const el = document.getElementById("catList" + suffix);
    if (!list.length) {
      el.innerHTML = `<div class="empty-state small">Nenhuma categoria de ${kind} ainda.</div>`;
      continue;
    }
    el.innerHTML = "";
    for (const c of list) {
      const locked = c.name === PROTECTED_CATEGORY;
      const used = monthTotals[c.id] || 0;
      const row = document.createElement("div");
      row.className = "cat-item";
      row.innerHTML = `
        <span class="cat-chip" style="background:${colors[c.id]}">${icon(categoryIcon(c.name, kind), "sm")}</span>
        <div class="cat-item-main">
          <div class="cat-item-name">${escapeHtml(c.name)}</div>
          <div class="cat-item-meta">${locked ? "usada nas faturas · não pode ser alterada" : used ? `${currency.format(used)} em ${MONTHS_LONG[viewDate.getMonth()].toLowerCase()}` : "sem lançamentos neste mês"}</div>
        </div>
        <div class="row-actions">${locked ? "" : `<button title="Editar" aria-label="Editar ${escapeHtml(c.name)}" data-edit>${icon("edit")}</button><button title="Excluir" aria-label="Excluir ${escapeHtml(c.name)}" data-del>${icon("trash")}</button>`}</div>`;
      if (!locked) {
        row.querySelector("[data-edit]").addEventListener("click", () => openCategoryModal({ category: c }));
        row.querySelector("[data-del]").addEventListener("click", () => deleteCategory(c));
      }
      el.appendChild(row);
    }
  }
}

function setCategoryFormKind(kind) {
  categoryFormKind = kind;
  document.querySelectorAll("#categoryKindToggle [data-kind]").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  updateCategoryPreview();
}
document.querySelectorAll("#categoryKindToggle [data-kind]").forEach((b) =>
  b.addEventListener("click", () => setCategoryFormKind(b.dataset.kind)));

function renderCategorySwatches() {
  const el = document.getElementById("categoryColors");
  el.innerHTML = CATEGORY_PALETTE.map((c) => `
    <button type="button" class="swatch${c === categoryFormColor ? " active" : ""}" role="radio" aria-checked="${c === categoryFormColor}"
      aria-label="Cor ${c}" data-color="${c}" style="background:${c}">${c === categoryFormColor ? icon("check", "sm") : ""}</button>`).join("");
  el.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
    categoryFormColor = b.dataset.color;
    renderCategorySwatches();
    updateCategoryPreview();
  }));
}

function updateCategoryPreview() {
  const name = document.getElementById("categoryName").value.trim();
  const chip = document.getElementById("categoryPreviewIcon");
  chip.style.background = categoryFormColor;
  chip.innerHTML = icon(categoryIcon(name, categoryFormKind), "sm");
  document.getElementById("categoryPreviewName").textContent = name || "Prévia";
}
document.getElementById("categoryName").addEventListener("input", updateCategoryPreview);

// cor sugerida pra uma categoria nova: a primeira da paleta que ainda não está em uso
function suggestedCategoryColor(kind) {
  const used = new Set(Object.values(categoryColorMap(kind)).map((c) => c.toLowerCase()));
  return CATEGORY_PALETTE.find((c) => !used.has(c.toLowerCase())) || CATEGORY_PALETTE[categories.filter((c) => c.kind === kind).length % CATEGORY_PALETTE.length];
}

function openCategoryModal({ category = null, kind = "despesa", target = null } = {}) {
  categoryTarget = target;
  document.getElementById("categoryForm").reset();
  document.getElementById("categoryId").value = category?.id || "";
  document.getElementById("categoryModalTitle").textContent = category ? "Editar categoria" : "Nova categoria";
  document.getElementById("categorySubmit").textContent = category ? "Salvar alterações" : "Criar categoria";
  // trocar o tipo de uma categoria em uso bagunçaria os lançamentos dela
  document.getElementById("categoryKindToggle").style.display = category || target ? "none" : "";
  document.getElementById("categoryName").value = category?.name || "";
  const k = category?.kind || kind;
  categoryFormColor = category ? categoryColorMap(k)[category.id] : suggestedCategoryColor(k);
  setCategoryFormKind(k);
  renderCategorySwatches();
  openModal("categoryModalOverlay");
  setTimeout(() => document.getElementById("categoryName").focus(), 50);
}
document.getElementById("openCategory").addEventListener("click", () => openCategoryModal());

// "+ Nova categoria…" dentro dos formulários de lançamento
for (const id of ["txCategory", "expCategory", "recCategory"]) {
  document.getElementById(id).addEventListener("change", (e) => {
    const sel = e.target;
    if (sel.value !== NEW_CATEGORY) return;
    sel.selectedIndex = 0;
    openCategoryModal({ kind: sel.dataset.kind || "despesa", target: id });
  });
}

guardedSubmit("categoryForm", async () => {
  const id = document.getElementById("categoryId").value;
  const name = document.getElementById("categoryName").value.trim().replace(/\s+/g, " ");
  if (!name) { showToast("Dê um nome pra categoria."); return; }
  if (name === PROTECTED_CATEGORY) { showToast(`"${PROTECTED_CATEGORY}" é reservada pras faturas.`); return; }
  const kind = id ? categories.find((c) => c.id === id)?.kind : categoryFormKind;
  const dup = categories.find((c) => c.kind === kind && c.id !== id && normalizeText(c.name) === normalizeText(name));
  if (dup) { showToast(`Já existe a categoria "${dup.name}".`); return; }

  let savedId = id;
  if (id) {
    const { error } = await mutate(supabase.from("categories").update({ name, color: categoryFormColor }).eq("id", id));
    if (error) return;
  } else {
    const { data, error } = await mutate(supabase.from("categories").insert({ name, kind, color: categoryFormColor }).select().single());
    if (error) return;
    savedId = data?.id;
  }
  closeModal("categoryModalOverlay");
  showToast(id ? "Categoria atualizada." : `Categoria "${name}" criada.`);
  await loadStaticData();
  renderAll();
  if (categoryTarget && savedId) {
    const sel = document.getElementById(categoryTarget);
    fillCategorySelect(categoryTarget, kind);
    sel.value = savedId;
    sel.dispatchEvent(new Event("change"));
  }
  categoryTarget = null;
});

async function deleteCategory(c) {
  const { count } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("category_id", c.id);
  const usage = count
    ? `${count} ${count === 1 ? "lançamento seu fica" : "lançamentos seus ficam"} sem categoria.`
    : "Nenhum lançamento seu usa ela.";
  const ok = await confirmDialog(
    `Excluir a categoria "${c.name}"? ${usage} Ela some também pra quem mais usa o app.`,
    "Excluir categoria",
    { yesLabel: "Excluir" }
  );
  if (!ok) return;
  const { error } = await mutate(supabase.from("categories").delete().eq("id", c.id));
  if (error) return;
  showToast("Categoria excluída.");
  await refreshAll();
}

// ---------- PRÓXIMOS VENCIMENTOS ----------
// despesas de conta pendentes (atrasadas ou nos próximos 7 dias), faturas em
// aberto que vencem nesse período e receitas que ainda vão cair
async function renderUpcoming() {
  const el = document.getElementById("upcomingList");
  const today = new Date();
  const todayISO = toISODate(today);
  const limitISO = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .is("card_id", null)
    .is("pays_invoice_id", null)
    .lte("date", limitISO)
    .or(`and(kind.eq.despesa,paid.eq.false),and(kind.eq.receita,date.gt.${todayISO})`)
    .order("date");

  const items = (data || []).map((t) => ({ type: t.kind, date: t.date, t }));
  for (const inv of invoices) {
    if (inv.due_date > limitISO) continue;
    const info = invoiceInfo(inv);
    if (["PAGA", "VAZIA", "FUTURA"].includes(info.status) || info.remaining <= 0.004) continue;
    items.push({ type: "fatura", date: inv.due_date, inv, info });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state small">Nada vencendo nos próximos 7 dias.</div>`;
    return;
  }
  el.innerHTML = "";
  for (const item of items.slice(0, 7)) {
    const late = item.date < todayISO;
    const when = late ? `Atrasado · venceu ${fmtDayMonth(item.date)}` : relativeDayLabel(item.date);
    let name, meta, value, ic, action, typeClass, isIncome = false;
    if (item.type === "fatura") {
      const card = cardById(item.inv.card_id);
      name = `Fatura ${card?.name || "cartão"}`;
      meta = `${when} · ${statusLabel(item.info.status).toLowerCase()}`;
      value = currency.format(item.info.remaining);
      ic = "receipt";
      action = "Pagar";
      typeClass = late ? "t-atrasado" : "t-fatura";
    } else {
      const t = item.t;
      const acc = accounts.find((a) => a.id === t.account_id);
      isIncome = t.kind === "receita";
      name = t.description;
      meta = `${when} · ${acc?.name || "—"}`;
      value = (isIncome ? "+ " : "") + currency.format(t.amount);
      ic = categoryVisual(t.category_id, t.kind).icon;
      action = isIncome ? "Recebido" : "Pagar";
      typeClass = isIncome ? "t-receita" : late ? "t-atrasado" : "t-despesa";
    }
    const row = document.createElement("div");
    row.className = "up-row";
    row.innerHTML = `
      <span class="up-icon ${typeClass}">${icon(ic)}</span>
      <div class="up-main"><div class="up-name">${escapeHtml(name)}</div><div class="up-meta${late ? " late" : ""}">${escapeHtml(meta)}</div></div>
      <span class="up-val${isIncome ? " inc" : ""}">${value}</span>
      <button class="up-btn${isIncome ? " inc" : ""}">${action}</button>`;
    row.querySelector(".up-btn").addEventListener("click", () => {
      if (item.type === "fatura") openPayModal(item.inv);
      else if (isIncome) markReceived(item.t);
      else togglePaid(item.t);
    });
    el.appendChild(row);
  }
}

function relativeDayLabel(iso) {
  const d = parseISO(iso);
  const today = parseISO(toISODate(new Date()));
  const diff = Math.round((d - today) / 86400000);
  const short = `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
  if (diff === 0) return `Hoje · ${short}`;
  if (diff === -1) return `Ontem · ${short}`;
  if (diff === 1) return `Amanhã · ${short}`;
  return `${WEEKDAYS[d.getDay()]}, ${short}`;
}

// ---------- LISTA DE LANÇAMENTOS ----------
let txFilter = "todos";
let txQuery = "";

document.querySelectorAll("#txFilters [data-filter]").forEach((b) => b.addEventListener("click", () => {
  txFilter = b.dataset.filter;
  document.querySelectorAll("#txFilters [data-filter]").forEach((x) => x.classList.toggle("active", x === b));
  renderTxList();
}));
document.getElementById("txSearch").addEventListener("input", (e) => {
  txQuery = normalizeText(e.target.value.trim());
  renderTxList();
});

function txMatches(t) {
  const todayISO = toISODate(new Date());
  if (txFilter === "despesa" && t.kind !== "despesa") return false;
  if (txFilter === "receita" && t.kind !== "receita") return false;
  if (txFilter === "pendente") {
    const pending = t.kind === "despesa" ? !t.paid && !t.card_id : t.date > todayISO;
    if (!pending) return false;
  }
  if (!txQuery) return true;
  const cat = categories.find((c) => c.id === t.category_id);
  const acc = accounts.find((a) => a.id === t.account_id);
  const card = t.card_id ? cardById(t.card_id) : null;
  return normalizeText([t.description, cat?.name, acc?.name, card?.name].join(" ")).includes(txQuery);
}

function invoiceMatches(inv, info) {
  if (txFilter === "receita") return false;
  if (txFilter === "pendente" && info.status === "PAGA") return false;
  if (!txQuery) return true;
  const card = cardById(inv.card_id);
  return normalizeText(`fatura ${card?.name || ""} ${card?.brand || ""}`).includes(txQuery);
}

function renderTxList() {
  const el = document.getElementById("txList");
  el.innerHTML = "";
  // compras no cartão não aparecem soltas: ficam dentro da linha da fatura,
  // que aparece no dia do vencimento. O pagamento também fica embutido nela.
  // Exceção: despesa fixa no cartão aparece no dia dela (só informativa,
  // o valor já está no total da fatura).
  const visible = transactions
    .filter((t) => (!t.card_id || t.recurring_month) && !t.pays_invoice_id && !t.carryover)
    .filter(txMatches);
  const dueInvoices = invoicesDueInMonth(viewDate).filter((x) => invoiceMatches(x.inv, x.info));
  if (visible.length === 0 && dueInvoices.length === 0) {
    const filtered = txFilter !== "todos" || txQuery;
    el.innerHTML = `<div class="empty-state">${filtered ? "Nada encontrado com esse filtro." : "Nenhum lançamento neste mês."}</div>`;
    return;
  }
  const groups = {};
  for (const x of dueInvoices) (groups[x.inv.due_date] ||= []).push(x);
  for (const t of visible) (groups[t.date] ||= []).push(t);
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
  for (const date of dates) {
    const wrap = document.createElement("div");
    wrap.className = "tx-day-group";
    const label = document.createElement("div");
    label.className = "tx-day-label";
    label.textContent = relativeDayLabel(date);
    wrap.appendChild(label);
    for (const item of groups[date]) {
      wrap.appendChild(item.inv ? invoiceRow(item.inv, item.info) : txRow(item));
    }
    el.appendChild(wrap);
  }
}

function txIconHtml(ic, color) {
  return `<div class="tx-icon" style="--c:${color}">${icon(ic)}</div>`;
}

function invoiceRow(inv, info) {
  const card = cardById(inv.card_id);
  const row = document.createElement("div");
  row.className = "tx-row invoice-row clickable" + (info.status !== "PAGA" ? " pending" : "");
  const count = info.purchases.length;
  const countLabel = `${count} ${count === 1 ? "compra" : "compras"}`;
  const meta = info.status === "PAGA"
    ? `Paga${info.lastPaymentDate ? " em " + fmtDayMonth(info.lastPaymentDate) : ""} · ${countLabel}`
    : `${info.paid > 0 ? `Pago ${currency.format(info.paid)} de ${currency.format(info.total)} · ` : ""}Fecha ${fmtDayMonth(inv.closing_date)} · ${countLabel}`;
  const shown = info.status === "PAGA" ? info.total : info.remaining;
  const canPay = info.remaining > 0.004;
  row.innerHTML = `
    ${txIconHtml("receipt", cardColor(card))}
    <div class="tx-main">
      <div class="desc">Fatura ${escapeHtml(card?.name || "cartão")} · ${invoiceShortLabel(inv)}<span class="badge">Fatura</span></div>
      <div class="meta">${escapeHtml(meta)}${canPay ? " · " + statusLabelText(info.status) : ""}</div>
    </div>
    <div class="status">${canPay ? `<button class="paid-pill pay" data-pay>Pagar</button>` : statusPill(info.status)}</div>
    <div class="amount despesa">− ${currency.format(shown)}</div>
    <div class="row-actions">${info.payments.length === 1 ? `<button title="Editar pagamento (data, valor, conta)" aria-label="Editar pagamento" data-edit-pay>${icon("edit")}</button>` : ""}<button title="Ver compras da fatura" aria-label="Ver compras da fatura" data-open>${icon("list")}</button></div>`;
  row.addEventListener("click", (e) => {
    if (e.target.closest("[data-pay],[data-edit-pay]")) return;
    openInvoiceModal(inv.id);
  });
  const editPay = row.querySelector("[data-edit-pay]");
  if (editPay) editPay.addEventListener("click", () => openPayModal(inv, info.payments[0]));
  if (canPay) row.querySelector("[data-pay]").addEventListener("click", () => openPayModal(inv));
  return row;
}

// despesa fixa no cartão: mostra na lista com a tag FIXA, mas não soma no
// saldo nem no "a pagar" (quem soma é a fatura onde ela entrou)
function cardOccurrenceRow(t) {
  const card = cardById(t.card_id);
  const inv = invoices.find((i) => i.id === t.invoice_id);
  const vis = categoryVisual(t.category_id, t.kind);
  const row = document.createElement("div");
  row.className = "tx-row card-occurrence";
  row.innerHTML = `
    ${txIconHtml(vis.icon, vis.color)}
    <div class="tx-main">
      <div class="desc">${escapeHtml(t.description)}<span class="badge badge-fixa">Fixa</span><span class="badge badge-card">Cartão</span></div>
      <div class="meta">${escapeHtml(card?.name || "Cartão")} · ${escapeHtml(vis.name)}${inv ? ` · já somada na fatura ${invoiceShortLabel(inv)}` : ""}</div>
    </div>
    <div class="status">${inv ? `<button class="paid-pill in-invoice" data-open-inv title="Ver fatura">Na fatura</button>` : ""}</div>
    <div class="amount despesa muted" title="Não soma no saldo: entra no total da fatura">− ${currency.format(t.amount)}</div>
    <div class="row-actions"><button title="Editar" aria-label="Editar" data-edit>${icon("edit")}</button><button title="Excluir" aria-label="Excluir" data-del>${icon("trash")}</button></div>`;
  row.querySelector("[data-edit]").addEventListener("click", () => editTransaction(t));
  row.querySelector("[data-del]").addEventListener("click", () => deleteTransaction(t));
  const open = row.querySelector("[data-open-inv]");
  if (open) open.addEventListener("click", () => openInvoiceModal(inv.id));
  return row;
}

function txRow(t) {
  if (t.card_id) return cardOccurrenceRow(t);
  const acc = accounts.find((a) => a.id === t.account_id);
  const vis = categoryVisual(t.category_id, t.kind);
  const isFutureReceita = t.kind === "receita" && t.date > toISODate(new Date());
  const row = document.createElement("div");
  row.className = "tx-row" + (t.paid === false || isFutureReceita ? " pending" : "");
  const badge = t.installment_total
    ? `<span class="badge">${t.installment_number}/${t.installment_total}</span>`
    : t.recurring_month
      ? `<span class="badge badge-fixa">Fixa</span>`
      : "";
  const canAddValue = t.kind === "despesa" && !t.installment_total && !t.recurring_month;
  const canTogglePaid = t.kind === "despesa";

  const paidPill = canTogglePaid
    ? `<button class="paid-pill ${t.paid ? "paid" : "pending"}" data-toggle-paid title="${t.paid ? "Marcar como pendente" : "Marcar como pago"}">${t.paid ? icon("check", "sm") + "Pago" : "Pendente"}</button>`
    : t.kind === "receita"
      ? (isFutureReceita
        ? `<button class="paid-pill receivable" data-mark-received title="Marcar como recebido hoje">A receber</button>`
        : t.original_date
          ? `<button class="paid-pill paid" data-unmark-received title="Desfazer recebimento">${icon("check", "sm")}Recebido</button>`
          : `<span class="paid-pill paid">${icon("check", "sm")}Recebido</span>`)
      : "";
  const addBtn = canAddValue ? `<button title="Adicionar valor" aria-label="Adicionar valor" data-add>${icon("plus")}</button>` : "";

  row.innerHTML = `
    ${txIconHtml(vis.icon, vis.color)}
    <div class="tx-main">
      <div class="desc">${escapeHtml(t.description)}${badge}</div>
      <div class="meta">${escapeHtml(acc?.name || "—")} · ${escapeHtml(vis.name)}</div>
    </div>
    <div class="status">${paidPill}</div>
    <div class="amount ${t.kind}">${t.kind === "despesa" ? "− " : "+ "}${currency.format(t.amount)}</div>
    <div class="row-actions">${addBtn}<button title="Editar" aria-label="Editar" data-edit>${icon("edit")}</button><button title="Excluir" aria-label="Excluir" data-del>${icon("trash")}</button></div>`;
  row.querySelector("[data-del]").addEventListener("click", () => deleteTransaction(t));
  row.querySelector("[data-edit]").addEventListener("click", () => editTransaction(t));
  if (canTogglePaid) row.querySelector("[data-toggle-paid]").addEventListener("click", () => togglePaid(t));
  const markReceivedBtn = row.querySelector("[data-mark-received]");
  if (markReceivedBtn) markReceivedBtn.addEventListener("click", () => markReceived(t));
  const unmarkReceivedBtn = row.querySelector("[data-unmark-received]");
  if (unmarkReceivedBtn) unmarkReceivedBtn.addEventListener("click", () => unmarkReceived(t));
  if (canAddValue) row.querySelector("[data-add]").addEventListener("click", () => openAddValueModal(t));
  return row;
}

// abre o editor certo pra cada tipo de lançamento
function editTransaction(t) {
  if (t.kind === "receita") return editTxModal(t);
  if (t.installment_group && t.installment_total) return openGroupModal(t.installment_group);
  if (t.recurring_id) return openExpenseModal({ mode: "recurring", rows: [t] });
  return openExpenseModal({ mode: "edit", rows: [t] });
}

async function markReceived(t) {
  const { error } = await mutate(
    supabase.from("transactions").update({ date: toISODate(new Date()), original_date: t.date }).eq("id", t.id)
  );
  if (error) return;
  await refreshAll();
}

async function unmarkReceived(t) {
  const { error } = await mutate(
    supabase.from("transactions").update({ date: t.original_date, original_date: null }).eq("id", t.id)
  );
  if (error) return;
  await refreshAll();
}

async function togglePaid(t) {
  const newPaid = !t.paid;
  const { error } = await mutate(supabase.from("transactions").update({ paid: newPaid }).eq("id", t.id));
  if (error) return;
  await refreshAll();
}

function renderAccountsGrid() {
  const grid = document.getElementById("accountsGrid");
  grid.innerHTML = "";
  if (accounts.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`;
    return;
  }
  for (const a of accounts) {
    const balance = accountBalances[a.id];
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="item-top">
        <span class="item-ic t-acc">${icon(ACCOUNT_ICONS[a.type] || "bank")}</span>
        <div><div class="name">${escapeHtml(a.name)}</div><div class="type">${typeLabel(a.type)}</div></div>
      </div>
      ${balance === undefined ? "" : `<div class="balance money-sensitive ${balance < 0 ? "exp" : ""}">${currency.format(balance)}</div>`}
      <div class="card-actions">
        <button class="btn btn-outline btn-sm" data-edit>${icon("edit", "sm")}Editar</button>
        <button class="btn btn-danger btn-sm" data-del>${icon("archive", "sm")}Arquivar</button>
      </div>`;
    card.querySelector("[data-edit]").addEventListener("click", () => openAccountModal(a));
    card.querySelector("[data-del]").addEventListener("click", () => archiveAccount(a));
    grid.appendChild(card);
  }
}

function typeLabel(t) {
  return { corrente: "Conta corrente", poupanca: "Poupança", dinheiro: "Dinheiro", investimento: "Investimento" }[t] || t;
}

function renderRecurringGrid() {
  const grid = document.getElementById("recurringGrid");
  grid.innerHTML = "";
  if (recurring.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhum lançamento fixo cadastrado. Use "Novo fixo" pra contas do mês ou pro salário.</div>`;
    return;
  }
  // receitas primeiro, depois despesas
  const sorted = recurring.slice().sort((a, b) => ((a.kind || "despesa") === (b.kind || "despesa") ? 0 : a.kind === "receita" ? -1 : 1));
  for (const r of sorted) {
    const isReceita = r.kind === "receita";
    const acc = accounts.find((a) => a.id === r.account_id);
    const payCard = r.card_id ? cardById(r.card_id) : null;
    const payLabel = payCard ? `Cartão ${payCard.name}` : (acc?.name || "—");
    const tone = !r.active ? "off" : isReceita ? "inc" : "exp";
    const ic = !r.active ? "pause" : categoryVisual(r.category_id, r.kind || "despesa").icon;
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="item-top">
        <span class="item-ic t-${tone}">${icon(ic)}</span>
        <div><div class="name">${escapeHtml(r.description)}</div><div class="type">${isReceita ? "Receita" : "Despesa"} · todo dia ${r.day_of_month}</div></div>
      </div>
      <div class="type">${escapeHtml(payLabel)}${r.active ? "" : " · Pausado"}</div>
      <div class="balance ${tone}">${isReceita ? "+ " : "− "}${currency.format(r.amount)}</div>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm" data-edit>${icon("edit", "sm")}Editar</button>
        <button class="btn btn-outline btn-sm" data-toggle>${icon(r.active ? "pause" : "play", "sm")}${r.active ? "Pausar" : "Ativar"}</button>
        <button class="btn btn-danger btn-sm" data-del>${icon("trash", "sm")}Excluir</button>
      </div>`;
    card.querySelector("[data-edit]").addEventListener("click", () => editRecurringModal(r));
    card.querySelector("[data-toggle]").addEventListener("click", () => toggleRecurring(r));
    card.querySelector("[data-del]").addEventListener("click", () => deleteRecurring(r));
    grid.appendChild(card);
  }
}

// ---------- CARTÕES / FATURAS ----------
// Modelo: compra no cartão é uma despesa como outra qualquer (conta nos
// gráficos pela data da compra), mas NÃO mexe no saldo. Quem sai da conta é
// o pagamento da fatura, que é um lançamento próprio (pays_invoice_id).
// Total e status da fatura são sempre calculados a partir das compras e
// pagamentos vinculados. A fatura é nomeada pelo mês de VENCIMENTO.
const MONTHS_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function cardById(id) { return allCards.find((c) => c.id === id); }
function parseISO(iso) { return new Date(iso + "T12:00:00"); }
function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDayMonth(iso) { const d = parseISO(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
function fmtDate(iso) { return parseISO(iso).toLocaleDateString("pt-BR"); }
function round2(n) { return Math.round(n * 100) / 100; }
function sumAmounts(rows) { return round2(rows.reduce((s, t) => s + Number(t.amount), 0)); }
function shortMonthLabel(iso) { const d = parseISO(iso); return `${MONTHS_SHORT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`; }
function invoiceShortLabel(inv) { return shortMonthLabel(inv.due_date); }
function longMonthLabel(iso) { const d = parseISO(iso); return `${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`; }
function invoiceLongLabel(inv) { return longMonthLabel(inv.due_date); }
function creditCardCategoryId() {
  return categories.find((c) => c.kind === "despesa" && c.name === "Cartão de crédito")?.id || null;
}

// FUTURA (ciclo ainda não começou, só parcelas) → ABERTA (ciclo atual, até
// o dia do fechamento) → FECHADA (fechou, não paga) → VENCIDA (passou do
// vencimento) | PAGA (pagamentos cobrem o total)
function invoiceInfo(inv) {
  const items = cardTransactions.filter((t) => t.invoice_id === inv.id);
  const payments = invoicePayments.filter((t) => t.pays_invoice_id === inv.id);
  const total = sumAmounts(items);
  const paid = sumAmounts(payments);
  const remaining = round2(total - paid);
  const today = toISODate(new Date());
  let status;
  if (items.length === 0 && payments.length === 0) status = "VAZIA";
  else if (remaining <= 0.004 && (paid > 0 || total <= 0)) status = "PAGA";
  else if (today <= inv.closing_date) {
    const card = cardById(inv.card_id);
    const current = card ? previewInvoice(card, new Date()) : null;
    status = current && inv.closing_date > current.closing_date ? "FUTURA" : "ABERTA";
  }
  else if (today <= inv.due_date) status = "FECHADA";
  else status = "VENCIDA";
  const lastPaymentDate = payments.map((p) => p.date).sort().pop() || null;
  return {
    items,
    purchases: items.filter((t) => !t.carryover),
    payments,
    total,
    paid,
    remaining,
    status,
    lastPaymentDate,
  };
}

function statusLabelText(status) {
  return {
    FUTURA: "futura",
    ABERTA: "aberta",
    FECHADA: "fechada",
    VENCIDA: "vencida",
    PAGA: "paga",
  }[status] || "";
}

function statusLabel(status) {
  const text = statusLabelText(status);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : status;
}

function statusPill(status) {
  return `<span class="status-pill st-${status.toLowerCase()}">${statusLabel(status)}</span>`;
}

function invoicesDueInMonth(date) {
  const { start, end } = monthBounds(date);
  const s = toISODate(start), e = toISODate(end);
  return invoices
    .filter((i) => i.due_date >= s && i.due_date <= e)
    .map((inv) => ({ inv, info: invoiceInfo(inv) }))
    .filter((x) => x.info.status !== "VAZIA");
}

function cardInvoicesWithInfo(cardId) {
  return invoices
    .filter((i) => i.card_id === cardId)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))
    .map((inv) => ({ inv, info: invoiceInfo(inv) }))
    .filter((x) => x.info.status !== "VAZIA");
}

function bestPurchaseDay(card) {
  return card.closing_day + 1;
}

function renderCardsGrid() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (cards.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhum cartão cadastrado ainda. Toque em "Adicionar cartão" pra começar.</div>`;
    return;
  }
  for (const card of cards) {
    const all = cardInvoicesWithInfo(card.id);
    const unpaid = all.filter((x) => x.info.status !== "PAGA");
    const lastPaid = all.filter((x) => x.info.status === "PAGA").pop();
    const timeline = [...(lastPaid ? [lastPaid] : []), ...unpaid];
    const used = round2(unpaid.reduce((s, x) => s + Math.max(x.info.remaining, 0), 0));
    const toPay = unpaid.find((x) => x.info.status === "VENCIDA")
      || unpaid.find((x) => x.info.status === "FECHADA")
      || unpaid[0];
    const payAcc = accounts.find((a) => a.id === card.payment_account_id);

    let limitHtml = "";
    if (card.limit_amount) {
      const limit = Number(card.limit_amount);
      const pct = Math.min(100, Math.max(0, (used / limit) * 100));
      limitHtml = `
        <div class="limit-wrap">
          <div class="limit-bar"><div class="limit-fill${pct > 90 ? " danger" : ""}" style="width:${pct}%"></div></div>
          <div class="limit-text">Disponível ${currency.format(Math.max(limit - used, 0))} de ${currency.format(limit)} · usado ${currency.format(used)}</div>
        </div>`;
    } else if (used > 0) {
      limitHtml = `<div class="limit-text">Em aberto (somando parcelas futuras): ${currency.format(used)}</div>`;
    }

    const chips = timeline.map(({ inv, info }) => {
      const shown = info.status === "PAGA" ? info.total : info.remaining;
      return `<button class="inv-chip st-${info.status.toLowerCase()}" data-inv="${inv.id}">
        <span class="inv-chip-month">${invoiceShortLabel(inv)}</span>
        <span class="inv-chip-status">${statusLabel(info.status)}</span>
        <span class="inv-chip-value">${currency.format(shown)}</span>
      </button>`;
    }).join("");

    const faceLabel = toPay
      ? `Fatura ${invoiceShortLabel(toPay.inv)} · ${statusLabelText(toPay.info.status)}`
      : "Nenhuma fatura em aberto";
    const el = document.createElement("div");
    el.className = "card-panel";
    el.innerHTML = `
      <div class="card-face" style="--card:${cardColor(card)}">
        <div class="card-face-top">
          <div class="name">${escapeHtml(card.name)}</div>
          <svg class="chip-svg" viewBox="0 0 40 28" aria-hidden="true"><rect x="1" y="1" width="38" height="26" rx="6" fill="rgba(255,255,255,0.85)"/><path d="M1 10h12M1 18h12M27 10h12M27 18h12M13 1v26M27 1v26" stroke="rgba(0,0,0,0.18)" stroke-width="1.5" fill="none"/></svg>
        </div>
        ${card.brand ? `<div class="brand-tag">${escapeHtml(card.brand)}</div>` : ""}
        <div class="face-dates">Fecha dia ${card.closing_day} · vence dia ${card.due_day}</div>
        <div><div class="face-label">${faceLabel}</div><div class="face-value">${currency.format(toPay ? Math.max(toPay.info.remaining, 0) : 0)}</div></div>
        ${limitHtml}
      </div>
      <div class="card-body">
        ${chips
          ? `<div class="invoice-chips">${chips}</div>`
          : `<div class="type">Nenhuma compra ainda. Use "Compra".</div>`}
        <div class="type">Fatura paga pela conta ${escapeHtml(payAcc?.name || "—")} · melhor dia de compra: ${bestPurchaseDay(card)}</div>
        <div class="card-actions">
          ${toPay ? `<button class="btn btn-primary btn-sm" data-pay>${icon("check", "sm")}Pagar ${invoiceShortLabel(toPay.inv)}</button>` : ""}
          <button class="btn btn-soft btn-sm" data-buy>${icon("plus", "sm")}Compra</button>
          <button class="btn btn-outline btn-sm" data-edit>${icon("edit", "sm")}Editar</button>
          <button class="btn btn-danger btn-sm" data-del>${icon("archive", "sm")}Arquivar</button>
        </div>
      </div>`;
    el.querySelectorAll("[data-inv]").forEach((b) => b.addEventListener("click", () => openInvoiceModal(b.dataset.inv)));
    el.querySelector("[data-buy]").addEventListener("click", () => openExpenseModal({ presetPay: "card:" + card.id }));
    el.querySelector("[data-edit]").addEventListener("click", () => openCardModal(card));
    el.querySelector("[data-del]").addEventListener("click", () => archiveCard(card));
    if (toPay) el.querySelector("[data-pay]").addEventListener("click", () => openPayModal(toPay.inv));
    grid.appendChild(el);
  }
}

function openCardModal(card) {
  document.getElementById("cardForm").reset();
  document.getElementById("cardId").value = card?.id || "";
  document.getElementById("cardModalTitle").textContent = card ? "Editar cartão" : "Novo cartão";
  document.getElementById("cardName").value = card?.name || "";
  document.getElementById("cardBrand").value = card?.brand || "";
  setMoneyInput(document.getElementById("cardLimit"), card?.limit_amount ?? "");
  document.getElementById("cardClosingDay").value = card?.closing_day || 25;
  document.getElementById("cardDueDay").value = card?.due_day || 5;
  document.getElementById("cardPaymentAccount").value = card?.payment_account_id || accounts[0]?.id || "";
  updateCardDaysHint();
  openModal("cardModalOverlay");
}

function updateCardDaysHint() {
  const c = Number(document.getElementById("cardClosingDay").value);
  const d = Number(document.getElementById("cardDueDay").value);
  const hint = document.getElementById("cardDaysHint");
  if (!c || !d) { hint.textContent = ""; return; }
  hint.textContent =
    `Compras até o dia ${c} entram na fatura que vence no dia ${d}${d <= c ? " do mês seguinte" : ""}. ` +
    `Compras a partir do dia ${c + 1} já vão pra fatura seguinte (melhor dia de compra: ${c + 1}).`;
}
document.getElementById("cardClosingDay").addEventListener("input", updateCardDaysHint);
document.getElementById("cardDueDay").addEventListener("input", updateCardDaysHint);

document.getElementById("openCard").addEventListener("click", () => {
  if (accounts.length === 0) { showToast("Cadastre uma conta antes: é dela que sai o pagamento da fatura."); return; }
  openCardModal(null);
});

guardedSubmit("cardForm", async () => {
  const id = document.getElementById("cardId").value;
  const row = {
    name: document.getElementById("cardName").value.trim(),
    brand: document.getElementById("cardBrand").value.trim() || null,
    limit_amount: document.getElementById("cardLimit").value.trim() ? moneyInputToNumber(document.getElementById("cardLimit")) : null,
    closing_day: Number(document.getElementById("cardClosingDay").value),
    due_day: Number(document.getElementById("cardDueDay").value),
    payment_account_id: document.getElementById("cardPaymentAccount").value,
  };
  const { error } = id
    ? await mutate(supabase.from("cards").update(row).eq("id", id))
    : await mutate(supabase.from("cards").insert({ ...row, user_id: user.id }));
  if (error) return;
  closeModal("cardModalOverlay");
  await refreshAll();
});

async function archiveCard(card) {
  if (!(await confirmDialog(`Arquivar o cartão "${card.name}"? As compras e faturas já lançadas são mantidas.`, "Arquivar cartão"))) return;
  const { error } = await mutate(supabase.from("cards").update({ archived: true }).eq("id", card.id));
  if (error) return;
  await refreshAll();
}

// ciclo de fatura: dado o dia de fechamento, acha o mês/ano da fatura que
// recebe uma compra feita em `date` (compra no dia do fechamento ainda entra)
function invoiceReferenceMonth(date, closingDay) {
  let year = date.getFullYear();
  let month0 = date.getMonth();
  if (date.getDate() > closingDay) {
    month0 += 1;
    if (month0 > 11) { month0 = 0; year += 1; }
  }
  return { year, month0 };
}

function shiftMonth(year, month0, n) {
  const m = month0 + n;
  return { year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
}

function invoiceDates(year, month0, closingDay, dueDay) {
  const closingDate = new Date(year, month0, closingDay);
  let dueYear = year, dueMonth0 = month0;
  if (dueDay <= closingDay) {
    dueMonth0 += 1;
    if (dueMonth0 > 11) { dueMonth0 = 0; dueYear += 1; }
  }
  const dueDate = new Date(dueYear, dueMonth0, dueDay);
  return { closingDate, dueDate };
}

function referenceMonthKey(year, month0) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

// a fatura (existente ou ainda não criada) que recebe uma compra em `date`,
// deslocada `offset` meses (parcela N = offset N-1). Não grava nada.
function previewInvoice(card, date, offset = 0) {
  const base = invoiceReferenceMonth(date, card.closing_day);
  const { year, month0 } = shiftMonth(base.year, base.month0, offset);
  const refMonth = referenceMonthKey(year, month0);
  const existing = invoices.find((i) => i.card_id === card.id && i.reference_month === refMonth) || null;
  if (existing) return { year, month0, existing, closing_date: existing.closing_date, due_date: existing.due_date };
  const { closingDate, dueDate } = invoiceDates(year, month0, card.closing_day, card.due_day);
  return { year, month0, existing: null, closing_date: toISODate(closingDate), due_date: toISODate(dueDate) };
}

async function ensureInvoice(card, year, month0) {
  const refMonth = referenceMonthKey(year, month0);
  const existing = invoices.find((i) => i.card_id === card.id && i.reference_month === refMonth);
  if (existing) return existing;
  const { closingDate, dueDate } = invoiceDates(year, month0, card.closing_day, card.due_day);
  const { data, error } = await mutate(
    supabase
      .from("invoices")
      .insert({
        user_id: user.id,
        card_id: card.id,
        reference_month: refMonth,
        closing_date: toISODate(closingDate),
        due_date: toISODate(dueDate),
      })
      .select()
      .single()
  );
  if (error) return null;
  invoices.push(data);
  return data;
}

// monta as linhas de uma compra no cartão (uma por parcela, cada uma na
// fatura do mês seguinte à anterior), criando as faturas que faltarem
async function buildCardRows(card, { desc, amounts, firstDate, categoryId, groupId }) {
  const count = amounts.length;
  const base = invoiceReferenceMonth(firstDate, card.closing_day);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const { year, month0 } = shiftMonth(base.year, base.month0, i);
    const inv = await ensureInvoice(card, year, month0);
    if (!inv) return null;
    rows.push({
      description: desc,
      amount: amounts[i],
      kind: "despesa",
      date: toISODate(addMonthsClamped(firstDate, i)),
      account_id: null,
      category_id: categoryId,
      installment_number: count > 1 ? i + 1 : null,
      installment_total: count > 1 ? count : null,
      installment_group: groupId,
      card_id: card.id,
      invoice_id: inv.id,
      paid: false,
      created_by: user.id,
    });
  }
  return rows;
}

// avisa quando uma compra nova/editada muda o total de uma fatura já paga
async function confirmPaidInvoiceChanges(newRows, oldRows) {
  const delta = {};
  for (const r of newRows) if (r.invoice_id) delta[r.invoice_id] = (delta[r.invoice_id] || 0) + Number(r.amount);
  for (const r of oldRows) if (r.invoice_id) delta[r.invoice_id] = (delta[r.invoice_id] || 0) - Number(r.amount);
  const touched = Object.entries(delta)
    .filter(([, d]) => Math.abs(d) > 0.004)
    .map(([id]) => invoices.find((i) => i.id === id))
    .filter((inv) => inv && invoiceInfo(inv).status === "PAGA");
  if (touched.length === 0) return true;
  const labels = touched.map(invoiceShortLabel).join(", ");
  return await confirmDialog(
    `A fatura de ${labels} já foi paga. Essa mudança altera o total dela e a diferença fica em aberto (dá pra pagar depois). Continuar?`,
    "Fatura já paga",
    { yesLabel: "Continuar" }
  );
}

document.getElementById("openCardPurchase").addEventListener("click", () => {
  if (cards.length === 0) { showToast("Cadastre um cartão primeiro (botão \"+ Cartão\")."); return; }
  openExpenseModal({ presetPay: "card:" + cards[0].id });
});

// ---------- DETALHE DA FATURA ----------
let openInvoiceId = null;

function openInvoiceModal(id) {
  openInvoiceId = id;
  renderInvoiceModal();
  openModal("invoiceModalOverlay");
}

function renderInvoiceModal() {
  const body = document.getElementById("invoiceBody");
  const inv = invoices.find((i) => i.id === openInvoiceId);
  if (!inv) { closeModal("invoiceModalOverlay"); return; }
  const card = cardById(inv.card_id);
  const info = invoiceInfo(inv);
  const siblings = cardInvoicesWithInfo(inv.card_id).map((x) => x.inv);
  const idx = siblings.findIndex((i) => i.id === inv.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const items = info.items.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const itemsHtml = items.length
    ? items.map((t) => {
      const cat = categories.find((c) => c.id === t.category_id);
      const badge = t.installment_total
        ? `<span class="badge">${t.installment_number}/${t.installment_total}</span>`
        : t.recurring_month ? `<span class="badge badge-fixa">Fixa</span>`
        : t.carryover ? `<span class="badge badge-card">Saldo</span>`
          : Number(t.amount) < 0 ? `<span class="badge">Estorno</span>` : "";
      const actions = t.carryover
        ? `<button title="Desfazer" aria-label="Desfazer" data-del="${t.id}">${icon("undo")}</button>`
        : `<button title="Editar" aria-label="Editar" data-edit="${t.id}">${icon("edit")}</button><button title="Excluir" aria-label="Excluir" data-del="${t.id}">${icon("trash")}</button>`;
      return `<div class="inv-item">
        <div class="inv-item-main">
          <div class="desc">${escapeHtml(t.description)}${badge}</div>
          <div class="meta">${fmtDayMonth(t.date)} · ${escapeHtml(cat?.name || "—")}</div>
        </div>
        <div class="inv-item-amount ${Number(t.amount) < 0 ? "credit" : ""}">${currency.format(t.amount)}</div>
        <div class="row-actions">${actions}</div>
      </div>`;
    }).join("")
    : `<div class="empty-state small">Nenhuma compra nesta fatura.</div>`;

  const paymentsHtml = info.payments.length
    ? `<div class="eyebrow section-gap">Pagamentos</div>` + info.payments.map((p) => {
      const acc = accounts.find((a) => a.id === p.account_id);
      return `<div class="inv-item">
        <div class="inv-item-main">
          <div class="desc">Pago em ${fmtDate(p.date)}</div>
          <div class="meta">Conta ${escapeHtml(acc?.name || "—")}</div>
        </div>
        <div class="inv-item-amount credit">${currency.format(p.amount)}</div>
        <div class="row-actions"><button title="Editar pagamento (data, valor, conta)" aria-label="Editar pagamento" data-edit-pay="${p.id}">${icon("edit")}</button><button title="Desfazer pagamento" aria-label="Desfazer pagamento" data-unpay="${p.id}">${icon("undo")}</button></div>
      </div>`;
    }).join("")
    : "";

  const remainingLabel = info.remaining < -0.004 ? "Crédito" : "Restante";
  body.innerHTML = `
    <div class="inv-head">
      <button class="nav-btn" data-prev ${prev ? "" : "disabled"} title="Fatura anterior" aria-label="Fatura anterior">${icon("chev-l")}</button>
      <div class="inv-head-title">
        <div class="eyebrow">${escapeHtml(card?.name || "Cartão")}</div>
        <h2>Fatura ${invoiceLongLabel(inv)}</h2>
      </div>
      <button class="nav-btn" data-next ${next ? "" : "disabled"} title="Próxima fatura" aria-label="Próxima fatura">${icon("chev-r")}</button>
    </div>
    <div class="inv-dates">${statusPill(info.status)} Fecha ${fmtDate(inv.closing_date)} · Vence ${fmtDate(inv.due_date)}</div>
    <div class="inv-totals">
      <div><span class="mono">TOTAL</span><strong>${currency.format(info.total)}</strong></div>
      <div><span class="mono">PAGO</span><strong>${currency.format(info.paid)}</strong></div>
      <div><span class="mono">${remainingLabel.toUpperCase()}</span><strong class="${info.remaining > 0.004 ? "neg" : ""}">${currency.format(Math.abs(info.remaining))}</strong></div>
    </div>
    <div class="eyebrow section-gap">Compras</div>
    ${itemsHtml}
    ${paymentsHtml}
    <div class="modal-actions">
      ${card && !card.archived ? `<button class="btn btn-outline btn-block" data-buy>${icon("plus","sm")}Compra</button>
      <button class="btn btn-outline btn-block" data-refund>${icon("undo","sm")}Estorno</button>` : ""}
      ${info.remaining > 0.004 ? `<button class="btn btn-primary btn-block" data-pay>Pagar ${currency.format(info.remaining)}</button>` : ""}
    </div>`;

  if (prev) body.querySelector("[data-prev]").addEventListener("click", () => { openInvoiceId = prev.id; renderInvoiceModal(); });
  if (next) body.querySelector("[data-next]").addEventListener("click", () => { openInvoiceId = next.id; renderInvoiceModal(); });
  body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    const t = info.items.find((x) => x.id === b.dataset.edit);
    if (t) editTransaction(t);
  }));
  body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const t = info.items.find((x) => x.id === b.dataset.del);
    if (t) deleteTransaction(t);
  }));
  body.querySelectorAll("[data-edit-pay]").forEach((b) => b.addEventListener("click", () => {
    const p = info.payments.find((x) => x.id === b.dataset.editPay);
    if (p) openPayModal(inv, p);
  }));
  body.querySelectorAll("[data-unpay]").forEach((b) => b.addEventListener("click", () => {
    const p = info.payments.find((x) => x.id === b.dataset.unpay);
    if (p) undoPayment(p);
  }));
  const buy = body.querySelector("[data-buy]");
  if (buy) buy.addEventListener("click", () => openExpenseModal({ presetPay: "card:" + card.id }));
  const refund = body.querySelector("[data-refund]");
  if (refund) refund.addEventListener("click", () => openExpenseModal({ presetPay: "card:" + card.id, refund: true }));
  const pay = body.querySelector("[data-pay]");
  if (pay) pay.addEventListener("click", () => openPayModal(inv));
}

async function undoPayment(p) {
  const acc = accounts.find((a) => a.id === p.account_id);
  const ok = await confirmDialog(
    `Desfazer o pagamento de ${currency.format(p.amount)} de ${fmtDate(p.date)}? O valor volta pro saldo da conta "${acc?.name || "—"}".`,
    "Desfazer pagamento",
    { yesLabel: "Desfazer" }
  );
  if (!ok) return;
  const { error } = await mutate(supabase.from("transactions").delete().eq("id", p.id));
  if (error) return;
  await refreshAll();
}

// ---------- PAGAR FATURA ----------
let payTarget = null;
let payEditing = null; // pagamento existente sendo editado (data/valor/conta)

function openPayModal(inv, payment = null) {
  const card = cardById(inv.card_id);
  const info = invoiceInfo(inv);
  payTarget = inv;
  payEditing = payment;
  document.getElementById("payForm").reset();
  document.getElementById("payModalTitle").textContent = payment ? "Editar pagamento" : "Pagar fatura";
  document.getElementById("paySubmit").textContent = payment ? "Salvar alterações" : "Confirmar pagamento";
  document.getElementById("payInfo").textContent =
    `Fatura ${card?.name || ""} de ${invoiceLongLabel(inv)}, vence ${fmtDate(inv.due_date)}. ` +
    `Total ${currency.format(info.total)}` +
    (info.paid > 0 ? `, já pago ${currency.format(info.paid)}` : "") +
    (payment ? "." : `. Restante: ${currency.format(Math.max(info.remaining, 0))}.`);
  setMoneyInput(document.getElementById("payAmount"), payment ? payment.amount : Math.max(info.remaining, 0));
  document.getElementById("payDate").value = payment ? payment.date : toISODate(new Date());
  document.getElementById("payAccount").innerHTML = accounts
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  document.getElementById("payAccount").value =
    (payment ? payment.account_id : card?.payment_account_id) || accounts[0]?.id || "";
  updatePayCarry();
  openModal("payModalOverlay");
}

function payCarryAmount() {
  if (!payTarget || payEditing) return 0;
  const info = invoiceInfo(payTarget);
  const amount = moneyInputToNumber(document.getElementById("payAmount"));
  return amount > 0 ? round2(info.remaining - amount) : 0;
}

function updatePayCarry() {
  const rest = payCarryAmount();
  const field = document.getElementById("payCarryField");
  field.style.display = rest > 0.004 ? "" : "none";
  if (rest > 0.004) {
    const card = cardById(payTarget.card_id);
    const [y, m] = payTarget.reference_month.split("-").map(Number);
    const nextRef = shiftMonth(y, m - 1, 1);
    const { dueDate } = invoiceDates(nextRef.year, nextRef.month0, card.closing_day, card.due_day);
    document.getElementById("payCarryLabel").textContent =
      `Jogar o restante (${currency.format(rest)}) pra fatura de ${shortMonthLabel(toISODate(dueDate))}`;
  }
}
document.getElementById("payAmount").addEventListener("input", updatePayCarry);

guardedSubmit("payForm", async () => {
  const inv = payTarget;
  if (!inv) return;
  const card = cardById(inv.card_id);
  const amount = moneyInputToNumber(document.getElementById("payAmount"));
  if (amount <= 0) { showToast("Informe o valor pago."); return; }
  const date = document.getElementById("payDate").value;

  if (payEditing) {
    const { error } = await mutate(supabase.from("transactions").update({
      amount, date, account_id: document.getElementById("payAccount").value,
    }).eq("id", payEditing.id));
    if (error) return;
    payEditing = null;
    closeModal("payModalOverlay");
    showToast("Pagamento atualizado.");
    await refreshAll();
    return;
  }

  const rest = payCarryAmount();
  const carry = rest > 0.004 && document.getElementById("payCarry").checked;

  const { error } = await mutate(supabase.from("transactions").insert({
    description: `Pagamento fatura ${card?.name || ""} · ${invoiceShortLabel(inv)}`,
    amount,
    kind: "despesa",
    date,
    account_id: document.getElementById("payAccount").value,
    category_id: creditCardCategoryId(),
    paid: true,
    pays_invoice_id: inv.id,
    created_by: user.id,
  }));
  if (error) return;

  if (carry && card) {
    // par de lançamentos: tira o restante desta fatura e soma na próxima
    const [y, m] = inv.reference_month.split("-").map(Number);
    const nextRef = shiftMonth(y, m - 1, 1);
    const nextInv = await ensureInvoice(card, nextRef.year, nextRef.month0);
    if (nextInv) {
      const pair = crypto.randomUUID();
      const base = {
        kind: "despesa", date, account_id: null, category_id: creditCardCategoryId(),
        card_id: card.id, carryover: true, installment_group: pair, paid: false, created_by: user.id,
      };
      await mutate(supabase.from("transactions").insert([
        { ...base, description: `Restante passado pra fatura ${invoiceShortLabel(nextInv)}`, amount: -rest, invoice_id: inv.id },
        { ...base, description: `Restante da fatura ${invoiceShortLabel(inv)}`, amount: rest, invoice_id: nextInv.id },
      ]));
    }
  }
  closeModal("payModalOverlay");
  showToast(`Pagamento de ${currency.format(amount)} registrado.`);
  await refreshAll();
});

// ---------- COMPRA PARCELADA (ver / editar / excluir parcelas) ----------
let openGroupId = null;

async function fetchGroup(groupId) {
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .eq("installment_group", groupId)
    .order("installment_number");
  return data || [];
}

async function openGroupModal(groupId) {
  openGroupId = groupId;
  const ok = await renderGroupModal();
  if (ok) openModal("groupModalOverlay");
}

async function renderGroupModal() {
  const body = document.getElementById("groupBody");
  const rows = await fetchGroup(openGroupId);
  if (rows.length === 0) { closeModal("groupModalOverlay"); return false; }
  const first = rows[0];
  const card = first.card_id ? cardById(first.card_id) : null;
  const acc = accounts.find((a) => a.id === first.account_id);
  const cat = categories.find((c) => c.id === first.category_id);
  const total = sumAmounts(rows);

  // parcelas que ainda vão cair em faturas depois da fatura atual
  let futureRows = [];
  let currentInv = null;
  if (card) {
    currentInv = previewInvoice(card, new Date());
    futureRows = rows.filter((r) => {
      const inv = invoices.find((i) => i.id === r.invoice_id);
      return inv && inv.due_date > currentInv.due_date;
    });
  }

  const list = rows.map((r) => {
    let where, pill;
    if (card) {
      const inv = invoices.find((i) => i.id === r.invoice_id);
      const info = inv ? invoiceInfo(inv) : null;
      where = inv ? `Fatura ${invoiceShortLabel(inv)}` : fmtDate(r.date);
      pill = info ? statusPill(info.status) : "";
    } else {
      where = fmtDate(r.date);
      pill = `<button class="paid-pill ${r.paid ? "paid" : "pending"}" data-toggle="${r.id}">${r.paid ? "Pago" : "Pendente"}</button>`;
    }
    return `<div class="inst-row">
      <span class="badge">${r.installment_number}/${r.installment_total}</span>
      <span class="inst-where">${where}</span>
      <span class="inst-pill">${pill}</span>
      <span class="inst-amount">${currency.format(r.amount)}</span>
      <button class="inst-del" title="Excluir só esta parcela" aria-label="Excluir só esta parcela" data-del-one="${r.id}">${icon("trash")}</button>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="eyebrow">Compra parcelada</div>
    <h2>${escapeHtml(first.description)}</h2>
    <p class="field-hint">
      ${card ? `Cartão ${escapeHtml(card.name)}` : `Conta ${escapeHtml(acc?.name || "—")}`} ·
      ${rows.length}x · total ${currency.format(total)} · ${escapeHtml(cat?.name || "—")}
    </p>
    <button class="btn btn-primary btn-block" data-edit-group>${icon("edit","sm")}Editar compra (valor, parcelas, data…)</button>
    <div class="eyebrow section-gap">Parcelas</div>
    <div class="inst-list">${list}</div>
    <div class="modal-actions">
      ${futureRows.length ? `<button class="btn btn-outline btn-block" data-anticipate>Antecipar ${futureRows.length} parcela(s)</button>` : ""}
      <button class="btn btn-danger btn-block" data-del-all>Excluir todas as ${rows.length} parcelas</button>
    </div>`;

  body.querySelector("[data-edit-group]").addEventListener("click", () => {
    closeModal("groupModalOverlay");
    openExpenseModal({ mode: "edit", rows });
  });
  body.querySelectorAll("[data-del-one]").forEach((b) => b.addEventListener("click", async () => {
    const r = rows.find((x) => x.id === b.dataset.delOne);
    const ok = await confirmDialog(
      `Excluir a parcela ${r.installment_number}/${r.installment_total} (${currency.format(r.amount)})? As outras são renumeradas.`,
      "Excluir parcela",
      { yesLabel: "Excluir" }
    );
    if (!ok) return;
    await deleteInstallments(rows, [r.id]);
  }));
  body.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const r = rows.find((x) => x.id === b.dataset.toggle);
    togglePaid(r);
  }));
  body.querySelector("[data-del-all]").addEventListener("click", async () => {
    const ok = await confirmDialog(
      `Excluir a compra "${first.description}" inteira (${rows.length} parcelas, ${currency.format(total)})?`,
      "Excluir compra",
      { yesLabel: "Excluir tudo" }
    );
    if (!ok) return;
    const { error } = await mutate(supabase.from("transactions").delete().eq("installment_group", openGroupId));
    if (error) return;
    closeModal("groupModalOverlay");
    showToast("Compra excluída.");
    await refreshAll();
  });
  const anticipate = body.querySelector("[data-anticipate]");
  if (anticipate) anticipate.addEventListener("click", async () => {
    const sum = sumAmounts(futureRows);
    const ok = await confirmDialog(
      `Trazer ${futureRows.length} parcela(s) (${currency.format(sum)}) pra fatura de ${shortMonthLabel(currentInv.due_date)}? ` +
      `Se o banco deu desconto, edite o valor depois.`,
      "Antecipar parcelas",
      { yesLabel: "Antecipar" }
    );
    if (!ok) return;
    const inv = await ensureInvoice(card, currentInv.year, currentInv.month0);
    if (!inv) return;
    const { error } = await mutate(
      supabase.from("transactions")
        .update({ invoice_id: inv.id, date: toISODate(new Date()) })
        .in("id", futureRows.map((r) => r.id))
    );
    if (error) return;
    showToast("Parcelas antecipadas.");
    await refreshAll();
  });
  return true;
}

// exclui algumas parcelas de um grupo e renumera as que sobrarem
// (1/9, 2/9…); se sobrar uma só, ela vira compra à vista
async function deleteInstallments(groupRows, ids) {
  const { error } = await mutate(supabase.from("transactions").delete().in("id", ids));
  if (error) return;
  const left = groupRows
    .filter((r) => !ids.includes(r.id))
    .sort((a, b) => a.installment_number - b.installment_number);
  if (left.length === 1) {
    await mutate(supabase.from("transactions")
      .update({ installment_number: null, installment_total: null, installment_group: null })
      .eq("id", left[0].id));
  } else if (left.length > 1) {
    await Promise.all(left.map((r, i) => mutate(
      supabase.from("transactions").update({ installment_number: i + 1, installment_total: left.length }).eq("id", r.id)
    )));
  }
  showToast(left.length ? `Parcela excluída. Agora são ${left.length}x.` : "Compra excluída.");
  await refreshAll();
}

function fillSelects() {
  const accOpts = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  document.getElementById("txAccount").innerHTML = accOpts;
  document.getElementById("recPay").innerHTML =
    `<optgroup label="Contas">${accounts.map((a) => `<option value="acc:${a.id}">${escapeHtml(a.name)}</option>`).join("")}</optgroup>` +
    (cards.length
      ? `<optgroup label="Cartões de crédito">${cards.map((c) => `<option value="card:${c.id}">${escapeHtml(c.name)} (cartão)</option>`).join("")}</optgroup>`
      : "");
  document.getElementById("cardPaymentAccount").innerHTML = accOpts;
  fillCategorySelect("txCategory", document.getElementById("txKind").value);
  fillCategorySelect("recCategory", "despesa");
}

function fillCategorySelect(id, kind) {
  const opts = categories
    .filter((c) => c.kind === kind)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  const sel = document.getElementById(id);
  sel.innerHTML = opts + `<option value="${NEW_CATEGORY}">+ Nova categoria…</option>`;
  sel.dataset.kind = kind;
}

// ---------- NAVEGAÇÃO (menu lateral, barra inferior e "Mais") ----------
const TABS = ["dashboard", "graficos", "contas", "cartoes", "fixas", "categorias"];

function showTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll(".nav-item[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  // no celular, Contas e Fixos ficam dentro do "Mais"
  document.getElementById("openMore").classList.toggle("active", ["contas", "fixas", "categorias"].includes(tab));
  TABS.forEach((t) => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? "" : "none";
  });
  closeModal("moreModalOverlay");
  window.scrollTo({ top: 0, behavior: "instant" });
  if (tab === "graficos" && reportData) drawTrendChart(reportData.months);
}
document.querySelectorAll(".nav-item[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
document.getElementById("openMore").addEventListener("click", () => openModal("moreModalOverlay"));

// ---------- MONTH NAV ----------
document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));

async function changeMonth(delta) {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  if (await ensureRecurringForVisibleMonth()) {
    await loadStaticData();
    renderCardsGrid();
  }
  await loadMonthTransactions();
  renderMonthLabel();
  renderTxList();
  renderCategoryBars();
  renderReport();
  renderSummary();
}

// ---------- MODAL HELPERS ----------
// cada modal aberto ganha um z-index maior que o anterior, pra quem abre
// por cima de outro (ex: editar compra a partir da fatura) ficar na frente
let modalZ = 100;
function openModal(id) {
  const el = document.getElementById(id);
  el.style.zIndex = ++modalZ;
  el.classList.add("open");
}
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
function isModalOpen(id) { return document.getElementById(id).classList.contains("open"); }

// trava o scroll do fundo enquanto qualquer modal-overlay estiver aberto,
// não importa por qual caminho foi aberto/fechado (openModal, confirmDialog,
// clique fora, botão de fechar). overflow:hidden sozinho não é confiável
// (o scroll já em andamento consegue continuar), então fixa o body na
// posição atual, tipo trava física, e restaura a posição ao fechar.
let lockedScrollY = 0;
function updateBodyScrollLock() {
  const anyOpen = document.querySelector(".modal-overlay.open") !== null;
  const isLocked = document.body.classList.contains("modal-open");
  if (anyOpen && !isLocked) {
    lockedScrollY = window.scrollY;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add("modal-open");
  } else if (!anyOpen && isLocked) {
    document.body.classList.remove("modal-open");
    document.body.style.top = "";
    window.scrollTo({ top: lockedScrollY, left: 0, behavior: "instant" });
  }
}
new MutationObserver(updateBodyScrollLock).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
  subtree: true,
});

// evita duplo envio: desabilita o botão de salvar enquanto o handler roda
function guardedSubmit(formId, handler) {
  const form = document.getElementById(formId);
  const submitBtn = form.querySelector('[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.classList.add("loading");
    try {
      await handler(e);
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("loading");
    }
  });
}

// ---------- CONFIRMAÇÃO (substitui window.confirm) ----------
// Retorna true (confirmou), false (cancelou) ou "extra" (clicou no botão extra).
function confirmDialog(message, title = "Confirmar", { yesLabel = "Confirmar", extraLabel = null } = {}) {
  return new Promise((resolve) => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");
    const extraBtn = document.getElementById("confirmExtra");
    const overlay = document.getElementById("confirmModalOverlay");
    yesBtn.textContent = yesLabel;
    if (extraLabel) {
      extraBtn.textContent = extraLabel;
      extraBtn.style.display = "";
    } else {
      extraBtn.style.display = "none";
    }
    function cleanup(result) {
      overlay.classList.remove("open");
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      extraBtn.removeEventListener("click", onExtra);
      overlay.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    function onExtra() { cleanup("extra"); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }
    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
    extraBtn.addEventListener("click", onExtra);
    overlay.addEventListener("click", onOverlay);
    overlay.style.zIndex = ++modalZ;
    overlay.classList.add("open");
  });
}
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest(".modal-overlay").classList.remove("open"));
});
document.querySelectorAll(".modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});

// ---------- NOVO LANÇAMENTO (um botão só) ----------
// abre como despesa; o seletor no topo de cada formulário troca pra receita
// ou fixo sem perder o fluxo
document.getElementById("openNew").addEventListener("click", () => openExpenseModal());
document.getElementById("openNewFab").addEventListener("click", () => openExpenseModal());

function wireTypeSwitch(switchId, ownType, overlayId) {
  document.querySelectorAll(`#${switchId} [data-type]`).forEach((b) => b.addEventListener("click", () => {
    const type = b.dataset.type;
    if (type === ownType) return;
    closeModal(overlayId);
    if (type === "despesa") openExpenseModal();
    else if (type === "receita") openTxModal("receita");
    else openNewRecurring();
  }));
}
wireTypeSwitch("expTypeSwitch", "despesa", "expenseModalOverlay");
wireTypeSwitch("txTypeSwitch", "receita", "txModalOverlay");
wireTypeSwitch("recTypeSwitch", "fixo", "recurringModalOverlay");

// ---------- RECEITA (modal simples) ----------
function openTxModal(kind) {
  document.getElementById("txId").value = "";
  document.getElementById("txKind").value = kind;
  document.getElementById("txModalTitle").textContent = kind === "receita" ? "Nova receita" : "Nova despesa";
  document.getElementById("txTypeSwitch").style.display = "";
  document.getElementById("txForm").reset();
  document.getElementById("txDate").value = toISODate(new Date());
  fillCategorySelect("txCategory", kind);
  openModal("txModalOverlay");
}

function editTxModal(t) {
  document.getElementById("txTypeSwitch").style.display = "none";
  document.getElementById("txId").value = t.id;
  document.getElementById("txKind").value = t.kind;
  document.getElementById("txModalTitle").textContent = t.kind === "receita" ? "Editar receita" : "Editar despesa";
  fillCategorySelect("txCategory", t.kind);
  document.getElementById("txDesc").value = t.description;
  setMoneyInput(document.getElementById("txAmount"), t.amount);
  document.getElementById("txDate").value = t.date;
  document.getElementById("txAccount").value = t.account_id || "";
  document.getElementById("txCategory").value = t.category_id || "";
  openModal("txModalOverlay");
}

guardedSubmit("txForm", async () => {
  const id = document.getElementById("txId").value;
  const kind = document.getElementById("txKind").value;
  const row = {
    description: document.getElementById("txDesc").value.trim(),
    amount: moneyInputToNumber(document.getElementById("txAmount")),
    kind,
    date: document.getElementById("txDate").value,
    account_id: document.getElementById("txAccount").value,
    category_id: selectedCategory("txCategory"),
  };
  const { error } = id
    ? await mutate(supabase.from("transactions").update(row).eq("id", id))
    : await mutate(supabase.from("transactions").insert({ ...row, created_by: user.id }));
  if (error) return;
  closeModal("txModalOverlay");
  await refreshAll();
});

// ---------- DESPESA (conta ou cartão, à vista ou parcelada) ----------
// Um modal só pra lançar e editar qualquer despesa. "Pagar com" decide se
// sai de uma conta ou entra na fatura de um cartão. Editar uma compra
// parcelada recria todas as parcelas a partir do formulário (dá pra mudar
// o nº de parcelas, o valor, a data e até o cartão de uma vez).
let expState = { mode: "new", rows: [], allowCards: true };
let expPay = ""; // "acc:<id>" | "card:<id>"
const LAST_PAY_KEY = "financas:lastPay";

function readLastPay() {
  try { return localStorage.getItem(LAST_PAY_KEY) || ""; } catch { return ""; }
}
function saveLastPay(v) {
  try { localStorage.setItem(LAST_PAY_KEY, v); } catch { /* sem storage, tudo bem */ }
}

function payOptions() {
  const opts = accounts.map((a) => ({ value: "acc:" + a.id, label: a.name, kind: "conta" }));
  if (expState.allowCards) {
    for (const c of cards) opts.push({ value: "card:" + c.id, label: c.name, kind: "cartão" });
    // compra de um cartão já arquivado continua editável
    if (expPay.startsWith("card:") && !opts.some((o) => o.value === expPay)) {
      const c = cardById(expPay.slice(5));
      if (c) opts.push({ value: expPay, label: c.name + " (arquivado)", kind: "cartão" });
    }
  }
  return opts;
}

function renderPayChips() {
  const el = document.getElementById("expPayChips");
  const opts = payOptions();
  if (!opts.some((o) => o.value === expPay)) expPay = opts[0]?.value || "";
  el.innerHTML = opts.map((o) => `
    <button type="button" class="chip ${o.value === expPay ? "active" : ""} ${o.kind === "cartão" ? "chip-card" : ""}" data-pay="${o.value}">
      <span class="chip-kind" title="${o.kind}">${icon(o.kind === "cartão" ? "card" : "bank", "sm")}</span>${escapeHtml(o.label)}
    </button>`).join("");
  el.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    expPay = b.dataset.pay;
    renderPayChips();
    updateExpenseForm();
  }));
}

function openExpenseModal({ mode = "new", rows = [], presetPay = null, refund = false } = {}) {
  if (accounts.length === 0 && cards.length === 0) {
    showToast("Cadastre uma conta ou um cartão primeiro.");
    return;
  }
  const sorted = rows.slice().sort((a, b) => (a.installment_number || 1) - (b.installment_number || 1));
  expState = { mode, rows: sorted, allowCards: true };
  document.getElementById("expenseForm").reset();
  fillCategorySelect("expCategory", "despesa");

  const isCardEdit = sorted.some((r) => r.card_id);
  document.getElementById("expModalTitle").textContent =
    mode === "new" ? (refund ? "Estorno no cartão" : "Nova despesa")
      : isCardEdit || sorted.length > 1 ? "Editar compra" : "Editar despesa";
  document.getElementById("expSubmit").textContent = mode === "new" ? "Salvar" : "Salvar alterações";
  document.getElementById("expTypeSwitch").style.display = mode === "new" && !refund ? "" : "none";

  if (mode === "new") {
    expPay = presetPay || readLastPay();
    document.getElementById("expDate").value = toISODate(new Date());
    document.getElementById("expCount").value = 1;
    document.getElementById("expIsTotal").checked = true;
    document.getElementById("expIsRefund").checked = refund;
  } else {
    const first = sorted[0];
    expPay = first.card_id ? "card:" + first.card_id : "acc:" + (first.account_id || "");
    document.getElementById("expDesc").value = first.description;
    document.getElementById("expCategory").value = first.category_id || "";
    const total = sumAmounts(sorted);
    const isRefund = total < 0;
    document.getElementById("expIsRefund").checked = isRefund;
    setMoneyInput(document.getElementById("expAmount"), Math.abs(total));
    document.getElementById("expCount").value = sorted.length;
    document.getElementById("expIsTotal").checked = true;
    // data da 1ª parcela (se a 1ª foi excluída, volta a partir da menor que sobrou)
    const firstDate = addMonthsClamped(parseISO(first.date), -((first.installment_number || 1) - 1));
    document.getElementById("expDate").value = toISODate(firstDate);
  }
  renderPayChips();
  updateExpenseForm();
  openModal("expenseModalOverlay");
}

function expAmounts() {
  const amountInput = moneyInputToNumber(document.getElementById("expAmount"));
  const isRefund = expIsCard() && expState.mode !== "recurring" && document.getElementById("expIsRefund").checked;
  const count = expCount();
  const isTotal = document.getElementById("expIsTotal").checked;
  let amounts = installmentAmounts(amountInput, count, count > 1 && isTotal);
  if (isRefund) amounts = amounts.map((a) => -a);
  return amounts;
}

function expIsCard() { return expPay.startsWith("card:"); }
function expCount() {
  if (expState.mode === "recurring") return 1;
  if (expIsCard() && expState.mode !== "recurring" && document.getElementById("expIsRefund").checked) return 1;
  return Math.max(1, Math.min(60, Number(document.getElementById("expCount").value) || 1));
}

function updateExpenseForm() {
  const isCard = expIsCard();
  const isRefund = isCard && expState.mode !== "recurring" && document.getElementById("expIsRefund").checked;
  const count = expCount();
  const isTotal = document.getElementById("expIsTotal").checked;

  // estorno só faz sentido em compra nova/à vista no cartão
  const canRefund = isCard && expState.rows.length <= 1 && expState.mode !== "recurring";
  document.getElementById("expRefundField").style.display = canRefund ? "" : "none";
  document.getElementById("expCountField").style.display = expState.mode === "recurring" || isRefund ? "none" : "";
  document.getElementById("expIsTotalField").style.display = count > 1 ? "" : "none";
  document.getElementById("expAmountLabel").textContent =
    isRefund ? "Valor do estorno (R$)"
      : count > 1 ? (isTotal ? "Valor total (R$)" : "Valor de cada parcela (R$)") : "Valor (R$)";
  document.getElementById("expDateLabel").textContent =
    isCard ? "Data da compra" : count > 1 ? "1ª parcela em" : "Data";

  const catSel = document.getElementById("expCategory");
  const catName = categories.find((c) => c.id === catSel.value)?.name;
  document.getElementById("expCategoryHint").style.display = catName === "Cartão de crédito" && !isCard ? "" : "none";

  renderExpensePreview();
}

function renderExpensePreview() {
  const box = document.getElementById("expPreview");
  const dateStr = document.getElementById("expDate").value;
  const amounts = expAmounts();
  const count = amounts.length;
  const hasAmount = amounts.some((a) => a !== 0);
  const lines = [];
  let warn = "";

  if (expIsCard() && dateStr) {
    const card = cardById(expPay.slice(5));
    const date = parseISO(dateStr);
    const firstInv = previewInvoice(card, date, 0);
    lines.push(
      `Entra na fatura de <b>${longMonthLabel(firstInv.due_date)}</b> ` +
      `(fecha ${fmtDayMonth(firstInv.closing_date)}, vence ${fmtDayMonth(firstInv.due_date)}).`
    );
    if (count > 1) {
      const lastInv = previewInvoice(card, date, count - 1);
      const differs = amounts[count - 1] !== amounts[0];
      lines.push(
        hasAmount
          ? `${count}x de <b>${currency.format(amounts[0])}</b>${differs ? ` (última de ${currency.format(amounts[count - 1])})` : ""}, ` +
            `até a fatura de ${shortMonthLabel(lastInv.due_date)}. Total ${currency.format(round2(amounts.reduce((s, a) => s + a, 0)))}.`
          : `${count} parcelas, até a fatura de ${shortMonthLabel(lastInv.due_date)}.`
      );
    }
    lines.push(`<span class="dim">Não sai do saldo agora: sai quando você pagar a fatura.</span>`);
    const ownIds = new Set(expState.rows.map((r) => r.invoice_id));
    if (firstInv.existing && !ownIds.has(firstInv.existing.id)) {
      const st = invoiceInfo(firstInv.existing).status;
      if (st === "PAGA") warn = "Essa fatura já foi paga. A compra vai deixar um valor em aberto nela.";
      else if (st === "FECHADA" || st === "VENCIDA") warn = "Essa fatura já fechou. Confira se a data da compra está certa.";
    }
  } else if (count > 1 && dateStr) {
    const date = parseISO(dateStr);
    const last = addMonthsClamped(date, count - 1);
    const acc = accounts.find((a) => "acc:" + a.id === expPay);
    lines.push(
      `${count}x${hasAmount ? ` de <b>${currency.format(amounts[0])}</b>` : ""}, de ${shortMonthLabel(dateStr)} a ${shortMonthLabel(toISODate(last))}, ` +
      `saindo da conta ${escapeHtml(acc?.name || "—")}. Cada parcela aparece como PENDENTE no mês dela.`
    );
  }
  if (expState.mode === "edit" && expState.rows.length > 1) {
    lines.push(`<span class="dim">Ao salvar, as ${expState.rows.length} parcelas atuais são substituídas por estas.</span>`);
  }

  if (lines.length === 0 && !warn) { box.style.display = "none"; return; }
  box.style.display = "";
  box.innerHTML = lines.map((l) => `<div>${l}</div>`).join("") + (warn ? `<div class="warn">⚠ ${warn}</div>` : "");
}

["expCount", "expAmount", "expDate"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateExpenseForm));
["expIsTotal", "expIsRefund", "expCategory", "expDate"].forEach((id) =>
  document.getElementById(id).addEventListener("change", updateExpenseForm));

guardedSubmit("expenseForm", async () => {
  const { mode, rows: oldRows } = expState;
  const desc = document.getElementById("expDesc").value.trim();
  const dateStr = document.getElementById("expDate").value;
  const categoryId = selectedCategory("expCategory");
  const amounts = expAmounts();
  const count = amounts.length;
  if (!expPay) { showToast("Escolha de onde sai o pagamento."); return; }
  if (amounts.every((a) => a === 0)) { showToast("Informe o valor."); return; }
  const [payType, payId] = expPay.split(":");

  // despesa simples de conta (ou ocorrência de despesa fixa): só atualiza
  const oldIsPlain = oldRows.length === 1 && !oldRows[0].card_id && !oldRows[0].installment_group;
  if (mode === "recurring" || (oldIsPlain && payType === "acc" && count === 1)) {
    const changes = { description: desc, amount: amounts[0], date: dateStr, category_id: categoryId };
    if (payType === "card") {
      // ocorrência de despesa fixa no cartão: vai pra fatura do ciclo da data
      const card = cardById(payId);
      const ref = invoiceReferenceMonth(parseISO(dateStr), card.closing_day);
      const inv = await ensureInvoice(card, ref.year, ref.month0);
      if (!inv) return;
      Object.assign(changes, { account_id: null, card_id: card.id, invoice_id: inv.id });
      if (!(await confirmPaidInvoiceChanges([{ ...changes, amount: amounts[0] }], oldRows))) return;
    } else {
      Object.assign(changes, { account_id: payId, card_id: null, invoice_id: null });
    }
    const { error } = await mutate(supabase.from("transactions").update(changes).eq("id", oldRows[0].id));
    if (error) return;
    closeModal("expenseModalOverlay");
    await refreshAll();
    return;
  }

  const firstDate = parseISO(dateStr);
  const groupId = count > 1 ? (oldRows.find((r) => r.installment_group)?.installment_group || crypto.randomUUID()) : null;
  let newRows;
  if (payType === "card") {
    const card = cardById(payId);
    if (!card) return;
    newRows = await buildCardRows(card, { desc, amounts, firstDate, categoryId, groupId });
    if (!newRows) return;
    if (!(await confirmPaidInvoiceChanges(newRows, oldRows))) return;
  } else {
    // mantém o PAGO/PENDENTE de cada parcela que continua existindo
    const paidByNumber = {};
    for (const r of oldRows) if (!r.card_id) paidByNumber[r.installment_number || 1] = r.paid;
    newRows = amounts.map((amount, i) => ({
      description: desc,
      amount,
      kind: "despesa",
      date: toISODate(addMonthsClamped(firstDate, i)),
      account_id: payId,
      category_id: categoryId,
      installment_number: count > 1 ? i + 1 : null,
      installment_total: count > 1 ? count : null,
      installment_group: groupId,
      paid: (i + 1) in paidByNumber ? paidByNumber[i + 1] : count === 1,
      created_by: user.id,
    }));
  }

  // grava as novas antes de apagar as antigas: se falhar, nada se perde
  const { error } = await mutate(supabase.from("transactions").insert(newRows));
  if (error) return;
  if (oldRows.length) {
    await mutate(supabase.from("transactions").delete().in("id", oldRows.map((r) => r.id)));
  }
  if (mode === "new") saveLastPay(expPay);
  closeModal("expenseModalOverlay");

  if (payType === "card") {
    const inv = invoices.find((i) => i.id === newRows[0].invoice_id);
    const card = cardById(payId);
    showToast(
      (mode === "new" ? "Compra lançada" : "Compra atualizada") +
      (inv ? ` na fatura de ${invoiceShortLabel(inv)} do ${card.name}` : "") +
      (count > 1 ? ` (${count}x)` : "") + "."
    );
  } else if (mode !== "new") {
    showToast("Despesa atualizada.");
  }
  await refreshAll();
});

// ---------- ADICIONAR VALOR A LANÇAMENTO EXISTENTE ----------
let addValueTarget = null;

function openAddValueModal(t) {
  addValueTarget = t;
  document.getElementById("addValueDesc").textContent = `${t.description} — atual: ${currency.format(t.amount)}`;
  document.getElementById("addValueForm").reset();
  openModal("addValueModalOverlay");
}

guardedSubmit("addValueForm", async () => {
  if (!addValueTarget) return;
  const extra = moneyInputToNumber(document.getElementById("addValueAmount"));
  const newAmount = Number(addValueTarget.amount) + extra;
  const { error } = await mutate(supabase.from("transactions").update({ amount: newAmount }).eq("id", addValueTarget.id));
  if (error) return;
  addValueTarget = null;
  closeModal("addValueModalOverlay");
  await refreshAll();
});

// dado o valor digitado, decide se ele já é o valor de cada parcela ou se
// precisa ser dividido (com o resto da divisão jogado na última parcela)
function installmentAmounts(amountInput, count, isTotal) {
  if (!isTotal) return Array(count).fill(Math.round(amountInput * 100) / 100);
  const base = Math.floor((amountInput / count) * 100) / 100;
  const remainder = Math.round((amountInput - base * count) * 100) / 100;
  const amounts = Array(count).fill(base);
  amounts[count - 1] = Math.round((base + remainder) * 100) / 100;
  return amounts;
}

function addMonthsClamped(date, n) {
  const year = date.getFullYear();
  const month = date.getMonth() + n;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(date.getDate(), daysInMonth(targetYear, targetMonth));
  return new Date(targetYear, targetMonth, day);
}

// ---------- CONTAS ----------
document.getElementById("openAccount").addEventListener("click", () => openAccountModal(null));

function openAccountModal(account) {
  document.getElementById("accountForm").reset();
  document.getElementById("accountId").value = account?.id || "";
  document.getElementById("accountName").value = account?.name || "";
  document.getElementById("accountType").value = account?.type || "corrente";
  openModal("accountModalOverlay");
}

guardedSubmit("accountForm", async () => {
  const id = document.getElementById("accountId").value;
  const row = {
    name: document.getElementById("accountName").value.trim(),
    type: document.getElementById("accountType").value,
  };
  const { error } = id
    ? await mutate(supabase.from("accounts").update(row).eq("id", id))
    : await mutate(supabase.from("accounts").insert({ ...row, user_id: user.id }));
  if (error) return;
  closeModal("accountModalOverlay");
  await loadStaticData();
  renderAll();
});

async function archiveAccount(a) {
  if (!(await confirmDialog(`Arquivar "${a.name}"? Os lançamentos existentes são mantidos.`, "Arquivar conta"))) return;
  const { error } = await mutate(supabase.from("accounts").update({ archived: true }).eq("id", a.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

// ---------- LANÇAMENTOS FIXOS (receita ou despesa) ----------
let recKind = "despesa";

function setRecKind(kind) {
  recKind = kind;
  document.querySelectorAll("#recKindToggle [data-kind]").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  const isReceita = kind === "receita";
  document.getElementById("recPayLabel").textContent = isReceita ? "Receber em" : "Pagar com";
  document.getElementById("recDesc").placeholder = isReceita ? "Ex: Salário, Aluguel recebido" : "Ex: Aluguel, Internet";
  // receita não cai em cartão de crédito
  const sel = document.getElementById("recPay");
  const group = sel.querySelector('optgroup[label="Cartões de crédito"]');
  if (group) group.hidden = isReceita;
  sel.querySelectorAll('option[value^="card:"]').forEach((o) => { o.disabled = isReceita; });
  if (isReceita && sel.value.startsWith("card:")) sel.value = sel.querySelector('option[value^="acc:"]')?.value || "";
  const cat = document.getElementById("recCategory").value;
  fillCategorySelect("recCategory", kind);
  if (cat) document.getElementById("recCategory").value = cat;
  if (!document.getElementById("recCategory").value) document.getElementById("recCategory").selectedIndex = 0;
  updateRecPayHint();
}
document.querySelectorAll("#recKindToggle [data-kind]").forEach((b) =>
  b.addEventListener("click", () => setRecKind(b.dataset.kind)));

function openNewRecurring() {
  document.getElementById("recurringForm").reset();
  document.getElementById("recurringId").value = "";
  document.getElementById("recurringModalTitle").textContent = "Lançamento fixo mensal";
  document.getElementById("recTypeSwitch").style.display = "";
  document.getElementById("recDay").value = 5;
  document.getElementById("recKindToggle").style.display = "";
  setRecKind("despesa");
  openModal("recurringModalOverlay");
}
document.getElementById("openRecurring").addEventListener("click", openNewRecurring);

function updateRecPayHint() {
  document.getElementById("recPayHint").style.display =
    recKind === "despesa" && document.getElementById("recPay").value.startsWith("card:") ? "" : "none";
}
document.getElementById("recPay").addEventListener("change", updateRecPayHint);

function editRecurringModal(r) {
  document.getElementById("recurringId").value = r.id;
  document.getElementById("recurringModalTitle").textContent = r.kind === "receita" ? "Editar receita fixa" : "Editar despesa fixa";
  document.getElementById("recTypeSwitch").style.display = "none";
  // trocar receita <-> despesa de um fixo existente bagunçaria o histórico
  document.getElementById("recKindToggle").style.display = "none";
  document.getElementById("recDesc").value = r.description;
  setMoneyInput(document.getElementById("recAmount"), r.amount);
  document.getElementById("recDay").value = r.day_of_month;
  const pay = r.card_id ? "card:" + r.card_id : "acc:" + (r.account_id || "");
  const sel = document.getElementById("recPay");
  // cartão arquivado continua aparecendo pra não trocar sem querer
  if (r.card_id && !sel.querySelector(`option[value="${pay}"]`)) {
    const c = cardById(r.card_id);
    sel.insertAdjacentHTML("beforeend", `<option value="${pay}">${escapeHtml(c?.name || "Cartão")} (arquivado)</option>`);
  }
  sel.value = pay;
  setRecKind(r.kind || "despesa");
  document.getElementById("recCategory").value = r.category_id || "";
  updateRecPayHint();
  openModal("recurringModalOverlay");
}

guardedSubmit("recurringForm", async () => {
  const id = document.getElementById("recurringId").value;
  const [payType, payId] = document.getElementById("recPay").value.split(":");
  if (recKind === "receita" && payType !== "acc") { showToast("Receita fixa precisa cair numa conta."); return; }
  const row = {
    kind: recKind,
    description: document.getElementById("recDesc").value.trim(),
    amount: moneyInputToNumber(document.getElementById("recAmount")),
    day_of_month: Number(document.getElementById("recDay").value),
    account_id: payType === "acc" ? payId : null,
    card_id: payType === "card" ? payId : null,
    category_id: selectedCategory("recCategory"),
  };
  const { error } = id
    ? await mutate(supabase.from("recurring_expenses").update(row).eq("id", id))
    : await mutate(supabase.from("recurring_expenses").insert({ ...row, start_date: toISODate(new Date()), active: true, created_by: user.id }));
  if (error) return;
  if (id) {
    // recria as ocorrências deste mês em diante com os dados novos (valor,
    // conta/cartão…). Fica o que já aconteceu: despesa de conta marcada PAGA
    // e receita que já caiu (data até hoje).
    const now = new Date();
    const todayISO = toISODate(now);
    const { data: occ } = await supabase
      .from("transactions")
      .select("id,kind,card_id,paid,date")
      .eq("recurring_id", id)
      .gte("recurring_month", referenceMonthKey(now.getFullYear(), now.getMonth()));
    const ids = (occ || [])
      .filter((t) => (t.kind === "receita" ? t.date > todayISO : t.card_id || !t.paid))
      .map((t) => t.id);
    if (ids.length) await mutate(supabase.from("transactions").delete().in("id", ids));
  }
  closeModal("recurringModalOverlay");
  await loadStaticData();
  await ensureRecurringForVisibleMonth();
  await refreshAll();
});

async function toggleRecurring(r) {
  const { error } = await mutate(supabase.from("recurring_expenses").update({ active: !r.active }).eq("id", r.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

async function deleteRecurring(r) {
  const now = new Date();
  const currentKey = referenceMonthKey(now.getFullYear(), now.getMonth());
  const choice = await confirmDialog(
    `Excluir o lançamento fixo "${r.description}"? Os lançamentos dos meses seguintes são apagados. ` +
    `Escolha se os deste mês pra trás ficam no histórico ou se apaga tudo.`,
    "Excluir lançamento fixo",
    { yesLabel: "Manter até este mês", extraLabel: "Apagar todos os meses" }
  );
  if (!choice) return;
  // apaga os lançamentos antes do cadastro: depois o vínculo (recurring_id) some
  let query = supabase.from("transactions").delete().eq("recurring_id", r.id);
  if (choice !== "extra") query = query.gt("recurring_month", currentKey);
  const { error: txError } = await mutate(query);
  if (txError) return;
  const { error } = await mutate(supabase.from("recurring_expenses").delete().eq("id", r.id));
  if (error) return;
  showToast(choice === "extra" ? "Lançamento fixo e todos os meses apagados." : "Lançamento fixo excluído. Histórico até este mês mantido.");
  await refreshAll();
}

// ---------- EXCLUIR LANÇAMENTO ----------
async function deleteTransaction(t) {
  if (t.carryover) {
    const ok = await confirmDialog(
      "Desfazer a passagem do restante pra outra fatura? O valor volta a ficar em aberto na fatura original.",
      "Desfazer restante",
      { yesLabel: "Desfazer" }
    );
    if (!ok) return;
    const { error } = await mutate(supabase.from("transactions").delete().eq("installment_group", t.installment_group));
    if (error) return;
    await refreshAll();
    return;
  }
  if (t.installment_total && t.installment_group) {
    const choice = await confirmDialog(
      `Esta é a parcela ${t.installment_number}/${t.installment_total} de "${t.description}".`,
      "Excluir parcela",
      { yesLabel: "Só esta parcela", extraLabel: `Todas as ${t.installment_total} parcelas` }
    );
    if (!choice) return;
    if (choice === "extra") {
      const { error } = await mutate(supabase.from("transactions").delete().eq("installment_group", t.installment_group));
      if (error) return;
      showToast("Compra excluída.");
      await refreshAll();
      return;
    }
    await deleteInstallments(await fetchGroup(t.installment_group), [t.id]);
    return;
  }
  const isFixedOccurrence = !!t.recurring_id;
  const confirmMsg = isFixedOccurrence
    ? `Excluir "${t.description}"? Ela não vai ser gerada de novo neste mês.`
    : `Excluir "${t.description}"?`;
  if (!(await confirmDialog(confirmMsg, "Excluir lançamento"))) return;
  if (isFixedOccurrence) {
    const { error: skipError } = await mutate(supabase.from("recurring_skips").upsert(
      { recurring_id: t.recurring_id, month: t.recurring_month, created_by: user.id },
      { onConflict: "recurring_id,month", ignoreDuplicates: true }
    ));
    if (skipError) return;
    recurringSkips.push({ recurring_id: t.recurring_id, month: t.recurring_month });
  }
  const { error } = await mutate(supabase.from("transactions").delete().eq("id", t.id));
  if (error) return;
  await refreshAll();
}

// recarrega tudo (cartões/faturas dependem de lançamentos de qualquer mês)
// e redesenha os modais de fatura/parcelas que estiverem abertos
async function refreshAll() {
  await loadStaticData();
  await loadMonthTransactions();
  renderAll();
  if (isModalOpen("invoiceModalOverlay")) renderInvoiceModal();
  if (isModalOpen("groupModalOverlay")) await renderGroupModal();
}

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
