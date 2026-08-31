import { supabase } from "./supabaseClient.js";
import { ensureProfile } from "./profile.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

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

let user = null;
let accounts = [];
let categories = [];
let recurring = [];
let transactions = []; // do mês atual
let viewDate = new Date(); // dia 1 = mês em foco
viewDate.setDate(1);

// ---------- BOOT ----------
init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  user = session.user;
  document.getElementById("userEmail").textContent = user.email;
  await ensureProfile(user);

  await loadStaticData();
  await ensureRecurringForVisibleMonth();
  await loadMonthTransactions();
  renderAll();

  document.getElementById("loadingVeil").style.display = "none";
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

// ---------- DATA LOADING ----------
async function loadStaticData() {
  const [accRes, catRes, recRes] = await Promise.all([
    supabase.from("accounts").select("*").eq("archived", false).order("created_at"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("recurring_expenses").select("*").order("created_at"),
  ]);
  accounts = accRes.data || [];
  categories = catRes.data || [];
  recurring = recRes.data || [];
}

function monthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
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
  const { data } = await supabase.from("transactions").select("account_id,kind,amount,paid");
  return data || [];
}

function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

async function ensureRecurringForVisibleMonth() {
  const year = viewDate.getFullYear();
  const month0 = viewDate.getMonth();
  const { start, end } = monthBounds(viewDate);
  const recurringMonth = `${year}-${String(month0 + 1).padStart(2, "0")}`;

  const rows = recurring
    .filter((r) => r.active)
    .filter((r) => new Date(r.start_date) <= end && (!r.end_date || new Date(r.end_date) >= start))
    .map((r) => {
      const day = Math.min(r.day_of_month, daysInMonth(year, month0));
      const date = new Date(year, month0, day);
      return {
        description: r.description,
        amount: r.amount,
        kind: "despesa",
        date: toISODate(date),
        account_id: r.account_id,
        category_id: r.category_id,
        recurring_id: r.id,
        recurring_month: recurringMonth,
        paid: false,
        created_by: user.id,
      };
    });

  if (rows.length === 0) return;
  await mutate(supabase.from("transactions").upsert(rows, { onConflict: "recurring_id,recurring_month", ignoreDuplicates: true }));
}

// ---------- RENDER ----------
function renderAll() {
  renderSummary();
  renderMonthLabel();
  renderTxList();
  renderAccountsGrid();
  renderRecurringGrid();
  fillSelects();
}

async function renderSummary() {
  const all = await loadAllTransactionsForBalance();
  const balanceByAccount = {};
  let total = 0;
  for (const a of accounts) balanceByAccount[a.id] = 0;
  for (const t of all) {
    if (!t.paid) continue; // pendente ainda não sai da conta
    const v = Number(t.amount) * (t.kind === "receita" ? 1 : -1);
    if (t.account_id in balanceByAccount) balanceByAccount[t.account_id] += v;
    total += v;
  }
  const pendingThisMonth = transactions
    .filter((t) => t.kind === "despesa" && !t.paid)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const grid = document.getElementById("summaryGrid");
  grid.innerHTML = "";
  grid.appendChild(summaryCard("Saldo total", total));
  if (pendingThisMonth > 0) {
    grid.appendChild(summaryCard("A pagar este mês", -pendingThisMonth, true));
  }
  for (const a of accounts) {
    grid.appendChild(summaryCard(a.name, balanceByAccount[a.id] || 0));
  }
}

function summaryCard(label, value, isPending = false) {
  const div = document.createElement("div");
  const negative = value < 0;
  div.className = "card" + (negative ? " negative" : "");
  const shown = isPending ? Math.abs(value) : value;
  div.innerHTML = `
    <div class="label mono">${escapeHtml(label)}</div>
    <div class="value ${negative ? "negative" : "positive"}">${currency.format(shown)}</div>`;
  return div;
}

function renderMonthLabel() {
  const label = monthFmt.format(viewDate);
  document.getElementById("monthLabel").textContent = label.toUpperCase();
}

function renderTxList() {
  const el = document.getElementById("txList");
  el.innerHTML = "";
  if (transactions.length === 0) {
    el.innerHTML = `<div class="empty-state">Nenhum lançamento neste mês.</div>`;
    return;
  }
  const groups = {};
  for (const t of transactions) {
    (groups[t.date] ||= []).push(t);
  }
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
  for (const date of dates) {
    const wrap = document.createElement("div");
    wrap.className = "tx-day-group";
    const label = document.createElement("div");
    label.className = "tx-day-label mono";
    label.textContent = dayFmt.format(new Date(date + "T12:00:00"));
    wrap.appendChild(label);
    for (const t of groups[date]) {
      wrap.appendChild(txRow(t));
    }
    el.appendChild(wrap);
  }
}

function txRow(t) {
  const acc = accounts.find((a) => a.id === t.account_id);
  const cat = categories.find((c) => c.id === t.category_id);
  const row = document.createElement("div");
  row.className = "tx-row" + (t.paid === false ? " pending" : "");
  const badge = t.installment_total
    ? `<span class="badge">${t.installment_number}/${t.installment_total}</span>`
    : t.recurring_id
      ? `<span class="badge">FIXA</span>`
      : "";
  const canAddValue = t.kind === "despesa" && !t.installment_total && !t.recurring_id;
  const canTogglePaid = t.kind === "despesa";

  const paidPill = canTogglePaid
    ? `<button class="paid-pill ${t.paid ? "paid" : "pending"}" data-toggle-paid>${t.paid ? "PAGO" : "PENDENTE"}</button>`
    : "";
  const addBtn = canAddValue ? `<button title="Adicionar valor" data-add>+</button>` : "";

  row.innerHTML = `
    <div class="desc">${escapeHtml(t.description)}${badge}</div>
    <div class="meta">${escapeHtml(acc?.name || "—")} · ${escapeHtml(cat?.name || "—")} ${paidPill}</div>
    <div class="amount ${t.kind}">${t.kind === "despesa" ? "-" : "+"}${currency.format(t.amount)}</div>
    <div class="row-actions">${addBtn}<button title="Editar" data-edit>✎</button><button title="Excluir" data-del>✕</button></div>`;
  row.querySelector("[data-del]").addEventListener("click", () => deleteTransaction(t));
  row.querySelector("[data-edit]").addEventListener("click", () => editTxModal(t));
  if (canTogglePaid) row.querySelector("[data-toggle-paid]").addEventListener("click", () => togglePaid(t));
  if (canAddValue) row.querySelector("[data-add]").addEventListener("click", () => openAddValueModal(t));
  return row;
}

async function togglePaid(t) {
  const { error } = await mutate(supabase.from("transactions").update({ paid: !t.paid }).eq("id", t.id));
  if (error) return;
  await refreshMonth();
}

function renderAccountsGrid() {
  const grid = document.getElementById("accountsGrid");
  grid.innerHTML = "";
  if (accounts.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`;
    return;
  }
  for (const a of accounts) {
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="name">${escapeHtml(a.name)}</div>
      <div class="type mono">${typeLabel(a.type)}</div>
      <div class="card-actions">
        <button class="btn btn-outline" data-edit>Editar</button>
        <button class="btn btn-danger" data-del>Arquivar</button>
      </div>`;
    card.querySelector("[data-edit]").addEventListener("click", () => openAccountModal(a));
    card.querySelector("[data-del]").addEventListener("click", () => archiveAccount(a));
    grid.appendChild(card);
  }
}

function typeLabel(t) {
  return { corrente: "Conta corrente", poupanca: "Poupança", cartao: "Cartão de crédito", dinheiro: "Dinheiro", investimento: "Investimento" }[t] || t;
}

function renderRecurringGrid() {
  const grid = document.getElementById("recurringGrid");
  grid.innerHTML = "";
  if (recurring.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhuma despesa fixa cadastrada.</div>`;
    return;
  }
  for (const r of recurring) {
    const acc = accounts.find((a) => a.id === r.account_id);
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="name">${escapeHtml(r.description)}</div>
      <div class="type mono">Todo dia ${r.day_of_month} · ${escapeHtml(acc?.name || "—")}</div>
      <div class="balance ${r.active ? "positive" : ""}" style="color:${r.active ? "var(--gold)" : "var(--bone-dim)"}">${currency.format(r.amount)}</div>
      <div class="card-actions">
        <button class="btn btn-outline" data-edit>Editar</button>
        <button class="btn btn-outline" data-toggle>${r.active ? "Pausar" : "Ativar"}</button>
        <button class="btn btn-danger" data-del>Excluir</button>
      </div>`;
    card.querySelector("[data-edit]").addEventListener("click", () => editRecurringModal(r));
    card.querySelector("[data-toggle]").addEventListener("click", () => toggleRecurring(r));
    card.querySelector("[data-del]").addEventListener("click", () => deleteRecurring(r));
    grid.appendChild(card);
  }
}

function fillSelects() {
  const accOpts = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  document.getElementById("txAccount").innerHTML = accOpts;
  document.getElementById("instAccount").innerHTML = accOpts;
  document.getElementById("recAccount").innerHTML = accOpts;
  fillCategorySelect("txCategory", document.getElementById("txKind").value);
  fillCategorySelect("instCategory", "despesa");
  fillCategorySelect("recCategory", "despesa");
}

function fillCategorySelect(id, kind) {
  const opts = categories
    .filter((c) => c.kind === kind)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  document.getElementById(id).innerHTML = opts;
}

// ---------- TABS ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["dashboard", "contas", "fixas"].forEach((t) => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? "" : "none";
    });
  });
});

// ---------- MONTH NAV ----------
document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));

async function changeMonth(delta) {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  await ensureRecurringForVisibleMonth();
  await loadMonthTransactions();
  renderMonthLabel();
  renderTxList();
}

// ---------- MODAL HELPERS ----------
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest(".modal-overlay").classList.remove("open"));
});
document.querySelectorAll(".modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});

// ---------- TRANSAÇÃO SIMPLES ----------
document.getElementById("openTxReceita").addEventListener("click", () => openTxModal("receita"));
document.getElementById("openTxDespesa").addEventListener("click", () => openTxModal("despesa"));

function openTxModal(kind) {
  document.getElementById("txId").value = "";
  document.getElementById("txKind").value = kind;
  document.getElementById("txModalTitle").textContent = kind === "receita" ? "Nova receita" : "Nova despesa";
  document.getElementById("txForm").reset();
  document.getElementById("txDate").value = toISODate(new Date());
  fillCategorySelect("txCategory", kind);
  openModal("txModalOverlay");
}

function editTxModal(t) {
  document.getElementById("txId").value = t.id;
  document.getElementById("txKind").value = t.kind;
  document.getElementById("txModalTitle").textContent = t.kind === "receita" ? "Editar receita" : "Editar despesa";
  fillCategorySelect("txCategory", t.kind);
  document.getElementById("txDesc").value = t.description;
  document.getElementById("txAmount").value = t.amount;
  document.getElementById("txDate").value = t.date;
  document.getElementById("txAccount").value = t.account_id || "";
  document.getElementById("txCategory").value = t.category_id || "";
  openModal("txModalOverlay");
}

document.getElementById("txForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("txId").value;
  const kind = document.getElementById("txKind").value;
  const row = {
    description: document.getElementById("txDesc").value.trim(),
    amount: Number(document.getElementById("txAmount").value),
    kind,
    date: document.getElementById("txDate").value,
    account_id: document.getElementById("txAccount").value,
    category_id: document.getElementById("txCategory").value,
  };
  const { error } = id
    ? await mutate(supabase.from("transactions").update(row).eq("id", id))
    : await mutate(supabase.from("transactions").insert({ ...row, created_by: user.id }));
  if (error) return;
  closeModal("txModalOverlay");
  await refreshMonth();
});

// ---------- ADICIONAR VALOR A LANÇAMENTO EXISTENTE ----------
let addValueTarget = null;

function openAddValueModal(t) {
  addValueTarget = t;
  document.getElementById("addValueDesc").textContent = `${t.description} — atual: ${currency.format(t.amount)}`;
  document.getElementById("addValueForm").reset();
  openModal("addValueModalOverlay");
}

document.getElementById("addValueForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!addValueTarget) return;
  const extra = Number(document.getElementById("addValueAmount").value);
  const newAmount = Number(addValueTarget.amount) + extra;
  const { error } = await mutate(supabase.from("transactions").update({ amount: newAmount }).eq("id", addValueTarget.id));
  if (error) return;
  addValueTarget = null;
  closeModal("addValueModalOverlay");
  await refreshMonth();
});

// ---------- PARCELADO ----------
document.getElementById("openInstallment").addEventListener("click", () => {
  document.getElementById("installmentForm").reset();
  document.getElementById("instDate").value = toISODate(new Date());
  openModal("installmentModalOverlay");
});

document.getElementById("installmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const desc = document.getElementById("instDesc").value.trim();
  const total = Number(document.getElementById("instAmount").value);
  const count = Number(document.getElementById("instCount").value);
  const firstDate = new Date(document.getElementById("instDate").value + "T12:00:00");
  const accountId = document.getElementById("instAccount").value;
  const categoryId = document.getElementById("instCategory").value;
  const groupId = crypto.randomUUID();

  const base = Math.floor((total / count) * 100) / 100;
  const remainder = Math.round((total - base * count) * 100) / 100;

  const rows = [];
  for (let i = 0; i < count; i++) {
    const d = addMonthsClamped(firstDate, i);
    rows.push({
      description: desc,
      amount: i === count - 1 ? Math.round((base + remainder) * 100) / 100 : base,
      kind: "despesa",
      date: toISODate(d),
      account_id: accountId,
      category_id: categoryId,
      installment_number: i + 1,
      installment_total: count,
      installment_group: groupId,
      paid: false,
      created_by: user.id,
    });
  }
  const { error } = await mutate(supabase.from("transactions").insert(rows));
  if (error) return;
  closeModal("installmentModalOverlay");
  await refreshMonth();
});

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

document.getElementById("accountForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("accountId").value;
  const row = {
    name: document.getElementById("accountName").value.trim(),
    type: document.getElementById("accountType").value,
  };
  const { error } = id
    ? await mutate(supabase.from("accounts").update(row).eq("id", id))
    : await mutate(supabase.from("accounts").insert(row));
  if (error) return;
  closeModal("accountModalOverlay");
  await loadStaticData();
  renderAll();
});

async function archiveAccount(a) {
  if (!confirm(`Arquivar "${a.name}"? Os lançamentos existentes são mantidos.`)) return;
  const { error } = await mutate(supabase.from("accounts").update({ archived: true }).eq("id", a.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

// ---------- DESPESAS FIXAS ----------
document.getElementById("openRecurring").addEventListener("click", () => {
  document.getElementById("recurringForm").reset();
  document.getElementById("recurringId").value = "";
  document.getElementById("recurringModalTitle").textContent = "Despesa Fixa Mensal";
  document.getElementById("recDay").value = 5;
  openModal("recurringModalOverlay");
});

function editRecurringModal(r) {
  document.getElementById("recurringId").value = r.id;
  document.getElementById("recurringModalTitle").textContent = "Editar Despesa Fixa";
  document.getElementById("recDesc").value = r.description;
  document.getElementById("recAmount").value = r.amount;
  document.getElementById("recDay").value = r.day_of_month;
  document.getElementById("recAccount").value = r.account_id || "";
  document.getElementById("recCategory").value = r.category_id || "";
  openModal("recurringModalOverlay");
}

document.getElementById("recurringForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("recurringId").value;
  const row = {
    description: document.getElementById("recDesc").value.trim(),
    amount: Number(document.getElementById("recAmount").value),
    day_of_month: Number(document.getElementById("recDay").value),
    account_id: document.getElementById("recAccount").value,
    category_id: document.getElementById("recCategory").value,
  };
  const { error } = id
    ? await mutate(supabase.from("recurring_expenses").update(row).eq("id", id))
    : await mutate(supabase.from("recurring_expenses").insert({ ...row, start_date: toISODate(new Date()), active: true, created_by: user.id }));
  if (error) return;
  closeModal("recurringModalOverlay");
  await loadStaticData();
  await ensureRecurringForVisibleMonth();
  await refreshMonth();
});

async function toggleRecurring(r) {
  const { error } = await mutate(supabase.from("recurring_expenses").update({ active: !r.active }).eq("id", r.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

async function deleteRecurring(r) {
  if (!confirm(`Excluir a despesa fixa "${r.description}"? Lançamentos já gerados são mantidos.`)) return;
  const { error } = await mutate(supabase.from("recurring_expenses").delete().eq("id", r.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

// ---------- EXCLUIR LANÇAMENTO ----------
async function deleteTransaction(t) {
  if (t.installment_total && !confirm(`Esta é a parcela ${t.installment_number}/${t.installment_total}. Excluir só esta parcela?`)) return;
  if (!t.installment_total && !confirm(`Excluir "${t.description}"?`)) return;
  const { error } = await mutate(supabase.from("transactions").delete().eq("id", t.id));
  if (error) return;
  await refreshMonth();
}

async function refreshMonth() {
  await loadMonthTransactions();
  renderTxList();
  renderSummary();
}

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
