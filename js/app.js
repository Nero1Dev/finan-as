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
let cards = [];
let invoices = [];
let cardTransactions = []; // todos os lançamentos vinculados a algum cartão, de qualquer mês
let transactions = []; // do mês atual
let viewDate = new Date(); // dia 1 = mês em foco
viewDate.setDate(1);

// ---------- BOOT ----------
init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/"; return; }
  user = session.user;
  await ensureProfile(user);
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
  document.getElementById("userLabel").textContent = profile?.username || user.email;

  await loadStaticData();
  await ensureRecurringForVisibleMonth();
  await loadMonthTransactions();
  renderAll();

  document.getElementById("loadingVeil").style.display = "none";
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "/";
});

// ---------- DATA LOADING ----------
async function loadStaticData() {
  const [accRes, catRes, recRes, cardRes, invRes, cardTxRes] = await Promise.all([
    supabase.from("accounts").select("*").eq("archived", false).order("created_at"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("recurring_expenses").select("*").order("created_at"),
    supabase.from("cards").select("*").eq("archived", false).order("created_at"),
    supabase.from("invoices").select("*"),
    supabase.from("transactions").select("*").not("card_id", "is", null),
  ]);
  accounts = accRes.data || [];
  categories = catRes.data || [];
  recurring = recRes.data || [];
  cards = cardRes.data || [];
  invoices = invRes.data || [];
  cardTransactions = cardTxRes.data || [];
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
  const { data } = await supabase.from("transactions").select("account_id,kind,amount,paid,date");
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
  renderDonut();
  renderAccountsGrid();
  renderCardsGrid();
  renderRecurringGrid();
  fillSelects();
}

async function renderSummary() {
  const all = await loadAllTransactionsForBalance();
  const todayISO = toISODate(new Date());
  const balanceByAccount = {};
  let total = 0;
  for (const a of accounts) balanceByAccount[a.id] = 0;
  for (const t of all) {
    if (t.kind === "despesa" && !t.paid) continue; // pendente ainda não saiu da conta
    if (t.kind === "receita" && t.date > todayISO) continue; // ainda não caiu na conta
    const v = Number(t.amount) * (t.kind === "receita" ? 1 : -1);
    if (t.account_id in balanceByAccount) balanceByAccount[t.account_id] += v;
    total += v;
  }
  const pendingThisMonth = transactions
    .filter((t) => t.kind === "despesa" && !t.paid)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const receivableThisMonth = transactions
    .filter((t) => t.kind === "receita" && t.date > todayISO)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const grid = document.getElementById("summaryGrid");
  grid.innerHTML = "";
  grid.appendChild(summaryCard("Saldo total", total));
  if (pendingThisMonth > 0) {
    grid.appendChild(summaryCard("A pagar este mês", -pendingThisMonth, true));
  }
  if (receivableThisMonth > 0) {
    grid.appendChild(summaryCard("A receber este mês", receivableThisMonth));
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
  const label = monthFmt.format(viewDate).toUpperCase();
  document.getElementById("monthLabel").textContent = label;
  document.getElementById("monthLabel2").textContent = label;
}

// ---------- GRÁFICOS (despesas por categoria) ----------
const CATEGORY_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER_COLOR = "#6b6259";

function categoryColorMap() {
  const despesaCats = categories.filter((c) => c.kind === "despesa");
  const map = {};
  despesaCats.forEach((c, i) => { map[c.id] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]; });
  return map;
}

function renderDonut() {
  const svg = document.getElementById("donutSvg");
  const legend = document.getElementById("donutLegend");
  const totalEl = document.getElementById("donutTotalValue");
  const empty = document.getElementById("donutEmpty");
  const layout = document.getElementById("donutLayout");
  if (!svg) return;

  const colorMap = categoryColorMap();
  const totals = {};
  for (const t of transactions) {
    if (t.kind !== "despesa") continue;
    totals[t.category_id] = (totals[t.category_id] || 0) + Number(t.amount);
  }

  let entries = Object.entries(totals)
    .filter(([, amount]) => amount > 0)
    .map(([catId, amount]) => {
      const cat = categories.find((c) => c.id === catId);
      return { name: cat?.name || "Sem categoria", amount, color: colorMap[catId] || OTHER_COLOR };
    })
    .sort((a, b) => b.amount - a.amount);

  svg.innerHTML = "";
  legend.innerHTML = "";

  if (entries.length === 0) {
    layout.style.display = "none";
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";
  layout.style.display = "";

  if (entries.length > 6) {
    const head = entries.slice(0, 5);
    const tailSum = entries.slice(5).reduce((s, e) => s + e.amount, 0);
    entries = [...head, { name: "Outras", amount: tailSum, color: OTHER_COLOR }];
  }

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
    const pct = ((e.amount / total) * 100).toFixed(1);
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `
      <span class="swatch" style="background:${e.color}"></span>
      <span class="legend-name">${escapeHtml(e.name)}</span>
      <span class="legend-pct mono">${pct}%</span>
      <span class="legend-amount mono">${currency.format(e.amount)}</span>`;
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
  const card = t.card_id ? cards.find((c) => c.id === t.card_id) : null;
  const cat = categories.find((c) => c.id === t.category_id);
  const isFutureReceita = t.kind === "receita" && t.date > toISODate(new Date());
  const row = document.createElement("div");
  row.className = "tx-row" + (t.paid === false || isFutureReceita ? " pending" : "");
  const badge = t.installment_total
    ? `<span class="badge">${t.installment_number}/${t.installment_total}</span>`
    : t.recurring_id
      ? `<span class="badge">FIXA</span>`
      : t.card_id
        ? `<span class="badge">CARTÃO</span>`
        : "";
  const canAddValue = t.kind === "despesa" && !t.installment_total && !t.recurring_id && !t.card_id;
  const canTogglePaid = t.kind === "despesa";

  const paidPill = canTogglePaid
    ? `<button class="paid-pill ${t.paid ? "paid" : "pending"}" data-toggle-paid>${t.paid ? "PAGO" : "PENDENTE"}</button>`
    : t.kind === "receita"
      ? `<span class="paid-pill ${isFutureReceita ? "pending" : "paid"}">${isFutureReceita ? "A RECEBER" : "RECEBIDO"}</span>`
      : "";
  const addBtn = canAddValue ? `<button title="Adicionar valor" data-add>+</button>` : "";
  const originLabel = card ? `${card.name} (cartão)` : (acc?.name || "—");

  row.innerHTML = `
    <div class="desc">${escapeHtml(t.description)}${badge}</div>
    <div class="meta">${escapeHtml(originLabel)} · ${escapeHtml(cat?.name || "—")} ${paidPill}</div>
    <div class="amount ${t.kind}">${t.kind === "despesa" ? "-" : "+"}${currency.format(t.amount)}</div>
    <div class="row-actions">${addBtn}<button title="Editar" data-edit>✎</button><button title="Excluir" data-del>✕</button></div>`;
  row.querySelector("[data-del]").addEventListener("click", () => deleteTransaction(t));
  row.querySelector("[data-edit]").addEventListener("click", () => editTxModal(t));
  if (canTogglePaid) row.querySelector("[data-toggle-paid]").addEventListener("click", () => togglePaid(t));
  if (canAddValue) row.querySelector("[data-add]").addEventListener("click", () => openAddValueModal(t));
  return row;
}

async function togglePaid(t) {
  const newPaid = !t.paid;
  const { error } = await mutate(supabase.from("transactions").update({ paid: newPaid }).eq("id", t.id));
  if (error) return;
  if (t.invoice_id) {
    const ct = cardTransactions.find((x) => x.id === t.id);
    if (ct) ct.paid = newPaid;
    renderCardsGrid();
  }
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
  return { corrente: "Conta corrente", poupanca: "Poupança", dinheiro: "Dinheiro", investimento: "Investimento" }[t] || t;
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

// ---------- CARTÕES / FATURAS ----------
function renderCardsGrid() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (cards.length === 0) {
    grid.innerHTML = `<div class="empty-state">Nenhum cartão cadastrado ainda.</div>`;
    return;
  }
  for (const card of cards) {
    const cardInvoices = invoices.filter((i) => i.card_id === card.id);
    const unpaidInvoices = cardInvoices
      .filter((i) => cardTransactions.some((t) => t.invoice_id === i.id && !t.paid))
      .sort((a, b) => (a.reference_month < b.reference_month ? -1 : 1)); // mais próxima primeiro
    const latestInvoice = cardInvoices
      .slice()
      .sort((a, b) => (a.reference_month < b.reference_month ? 1 : -1))[0]; // mais recente primeiro
    const openInvoice = unpaidInvoices[0] || latestInvoice;

    let totalLabel = "Sem compras ainda";
    let statusLabel = "";
    let dueLabel = "";
    let hasUnpaid = false;
    if (openInvoice) {
      const txs = cardTransactions.filter((t) => t.invoice_id === openInvoice.id);
      const total = txs.reduce((s, t) => s + Number(t.amount), 0);
      hasUnpaid = txs.some((t) => !t.paid);
      const allPaid = txs.length > 0 && txs.every((t) => t.paid);
      const somePaid = txs.some((t) => t.paid);
      const status = allPaid ? "PAGA" : somePaid ? "PARCIAL" : "ABERTA";
      const refLabel = monthFmt.format(new Date(openInvoice.reference_month + "-01T12:00:00")).toUpperCase();
      totalLabel = currency.format(total);
      statusLabel = `${refLabel} · ${status}`;
      dueLabel = `Vence em ${new Date(openInvoice.due_date + "T12:00:00").toLocaleDateString("pt-BR")}`;
    }

    const payAcc = accounts.find((a) => a.id === card.payment_account_id);
    const el = document.createElement("div");
    el.className = "item-card";
    el.innerHTML = `
      <div class="name">${escapeHtml(card.name)}${card.brand ? ` · ${escapeHtml(card.brand)}` : ""}</div>
      <div class="type mono">${escapeHtml(statusLabel || "Sem fatura ainda")}${dueLabel ? " · " + escapeHtml(dueLabel) : ""}</div>
      <div class="balance" style="color:var(--gold)">${totalLabel}</div>
      <div class="type mono">Pago pela conta: ${escapeHtml(payAcc?.name || "—")}</div>
      <div class="card-actions">
        ${hasUnpaid ? `<button class="btn btn-outline" data-pay>Pagar fatura</button>` : ""}
        <button class="btn btn-outline" data-edit>Editar</button>
        <button class="btn btn-danger" data-del>Arquivar</button>
      </div>`;
    el.querySelector("[data-edit]").addEventListener("click", () => openCardModal(card));
    el.querySelector("[data-del]").addEventListener("click", () => archiveCard(card));
    if (hasUnpaid) el.querySelector("[data-pay]").addEventListener("click", () => payInvoice(openInvoice, card));
    grid.appendChild(el);
  }
}

function openCardModal(card) {
  document.getElementById("cardForm").reset();
  document.getElementById("cardId").value = card?.id || "";
  document.getElementById("cardName").value = card?.name || "";
  document.getElementById("cardBrand").value = card?.brand || "";
  document.getElementById("cardLimit").value = card?.limit_amount ?? "";
  document.getElementById("cardClosingDay").value = card?.closing_day || 25;
  document.getElementById("cardDueDay").value = card?.due_day || 5;
  document.getElementById("cardPaymentAccount").value = card?.payment_account_id || "";
  openModal("cardModalOverlay");
}

document.getElementById("openCard").addEventListener("click", () => openCardModal(null));

guardedSubmit("cardForm", async () => {
  const id = document.getElementById("cardId").value;
  const row = {
    name: document.getElementById("cardName").value.trim(),
    brand: document.getElementById("cardBrand").value.trim() || null,
    limit_amount: document.getElementById("cardLimit").value ? Number(document.getElementById("cardLimit").value) : null,
    closing_day: Number(document.getElementById("cardClosingDay").value),
    due_day: Number(document.getElementById("cardDueDay").value),
    payment_account_id: document.getElementById("cardPaymentAccount").value,
  };
  const { error } = id
    ? await mutate(supabase.from("cards").update(row).eq("id", id))
    : await mutate(supabase.from("cards").insert({ ...row, user_id: user.id }));
  if (error) return;
  closeModal("cardModalOverlay");
  await loadStaticData();
  renderCardsGrid();
  fillSelects();
});

async function archiveCard(card) {
  if (!(await confirmDialog(`Arquivar o cartão "${card.name}"? As compras já feitas são mantidas.`, "Arquivar cartão"))) return;
  const { error } = await mutate(supabase.from("cards").update({ archived: true }).eq("id", card.id));
  if (error) return;
  await loadStaticData();
  renderCardsGrid();
  fillSelects();
}

// ciclo de fatura: dado o dia de fechamento, acha o mês/ano da fatura que
// recebe uma compra feita em `date`
function invoiceReferenceMonth(date, closingDay) {
  let year = date.getFullYear();
  let month0 = date.getMonth();
  if (date.getDate() > closingDay) {
    month0 += 1;
    if (month0 > 11) { month0 = 0; year += 1; }
  }
  return { year, month0 };
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

async function payInvoice(invoice, card) {
  const refLabel = monthFmt.format(new Date(invoice.reference_month + "-01T12:00:00")).toUpperCase();
  const payAcc = accounts.find((a) => a.id === card.payment_account_id);
  const ok = await confirmDialog(
    `Marcar a fatura de ${refLabel} do cartão "${card.name}" como paga? O valor sai da conta "${payAcc?.name || "—"}".`,
    "Pagar fatura"
  );
  if (!ok) return;
  const { error } = await mutate(
    supabase.from("transactions").update({ paid: true }).eq("invoice_id", invoice.id).eq("paid", false)
  );
  if (error) return;
  await loadStaticData();
  renderCardsGrid();
  await refreshMonth();
}

document.getElementById("openCardPurchase").addEventListener("click", () => {
  document.getElementById("cardPurchaseForm").reset();
  document.getElementById("purchaseDate").value = toISODate(new Date());
  document.getElementById("purchaseAmountLabel").textContent = "Valor da parcela (R$)";
  fillCategorySelect("purchaseCategory", "despesa");
  openModal("cardPurchaseModalOverlay");
});

document.getElementById("purchaseIsTotal").addEventListener("change", (e) => {
  document.getElementById("purchaseAmountLabel").textContent = e.target.checked ? "Valor total (R$)" : "Valor da parcela (R$)";
});

guardedSubmit("cardPurchaseForm", async () => {
  const cardId = document.getElementById("purchaseCard").value;
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;

  const desc = document.getElementById("purchaseDesc").value.trim();
  const amountInput = Number(document.getElementById("purchaseAmount").value);
  const count = Number(document.getElementById("purchaseCount").value);
  const isTotal = document.getElementById("purchaseIsTotal").checked;
  const firstDate = new Date(document.getElementById("purchaseDate").value + "T12:00:00");
  const categoryId = document.getElementById("purchaseCategory").value;
  const groupId = count > 1 ? crypto.randomUUID() : null;
  const amounts = installmentAmounts(amountInput, count, isTotal);

  let { year, month0 } = invoiceReferenceMonth(firstDate, card.closing_day);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const inv = await ensureInvoice(card, year, month0);
    if (!inv) return;
    const d = addMonthsClamped(firstDate, i);
    rows.push({
      description: desc,
      amount: amounts[i],
      kind: "despesa",
      date: toISODate(d),
      account_id: card.payment_account_id,
      category_id: categoryId,
      installment_number: count > 1 ? i + 1 : null,
      installment_total: count > 1 ? count : null,
      installment_group: groupId,
      card_id: card.id,
      invoice_id: inv.id,
      paid: false,
      created_by: user.id,
    });
    month0 += 1;
    if (month0 > 11) { month0 = 0; year += 1; }
  }

  const { error } = await mutate(supabase.from("transactions").insert(rows));
  if (error) return;
  closeModal("cardPurchaseModalOverlay");
  await loadStaticData();
  renderCardsGrid();
  await refreshMonth();
});

function fillSelects() {
  const accOpts = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  document.getElementById("txAccount").innerHTML = accOpts;
  document.getElementById("instAccount").innerHTML = accOpts;
  document.getElementById("recAccount").innerHTML = accOpts;
  document.getElementById("cardPaymentAccount").innerHTML = accOpts;
  document.getElementById("purchaseCard").innerHTML = cards
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  fillCategorySelect("txCategory", document.getElementById("txKind").value);
  fillCategorySelect("instCategory", "despesa");
  fillCategorySelect("recCategory", "despesa");
  fillCategorySelect("purchaseCategory", "despesa");
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
    ["dashboard", "graficos", "contas", "cartoes", "fixas"].forEach((t) => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? "" : "none";
    });
  });
});

// ---------- MONTH NAV ----------
document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));
document.getElementById("prevMonth2").addEventListener("click", () => changeMonth(-1));
document.getElementById("nextMonth2").addEventListener("click", () => changeMonth(1));

async function changeMonth(delta) {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  await ensureRecurringForVisibleMonth();
  await loadMonthTransactions();
  renderMonthLabel();
  renderTxList();
  renderDonut();
}

// ---------- MODAL HELPERS ----------
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

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
    overlay.classList.add("open");
  });
}
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

guardedSubmit("txForm", async () => {
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

guardedSubmit("addValueForm", async () => {
  if (!addValueTarget) return;
  const extra = Number(document.getElementById("addValueAmount").value);
  const newAmount = Number(addValueTarget.amount) + extra;
  const { error } = await mutate(supabase.from("transactions").update({ amount: newAmount }).eq("id", addValueTarget.id));
  if (error) return;
  addValueTarget = null;
  closeModal("addValueModalOverlay");
  await refreshMonth();
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

// ---------- PARCELADO ----------
document.getElementById("openInstallment").addEventListener("click", () => {
  document.getElementById("installmentForm").reset();
  document.getElementById("instDate").value = toISODate(new Date());
  document.getElementById("instAmountLabel").textContent = "Valor da parcela (R$)";
  openModal("installmentModalOverlay");
});

document.getElementById("instIsTotal").addEventListener("change", (e) => {
  document.getElementById("instAmountLabel").textContent = e.target.checked ? "Valor total (R$)" : "Valor da parcela (R$)";
});

guardedSubmit("installmentForm", async () => {
  const desc = document.getElementById("instDesc").value.trim();
  const amountInput = Number(document.getElementById("instAmount").value);
  const count = Number(document.getElementById("instCount").value);
  const isTotal = document.getElementById("instIsTotal").checked;
  const firstDate = new Date(document.getElementById("instDate").value + "T12:00:00");
  const accountId = document.getElementById("instAccount").value;
  const categoryId = document.getElementById("instCategory").value;
  const groupId = crypto.randomUUID();
  const amounts = installmentAmounts(amountInput, count, isTotal);

  const rows = [];
  for (let i = 0; i < count; i++) {
    const d = addMonthsClamped(firstDate, i);
    rows.push({
      description: desc,
      amount: amounts[i],
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

guardedSubmit("recurringForm", async () => {
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
  renderRecurringGrid();
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
  if (!(await confirmDialog(`Excluir a despesa fixa "${r.description}"? Lançamentos já gerados são mantidos.`, "Excluir despesa fixa"))) return;
  const { error } = await mutate(supabase.from("recurring_expenses").delete().eq("id", r.id));
  if (error) return;
  await loadStaticData();
  renderAll();
}

// ---------- EXCLUIR LANÇAMENTO ----------
async function deleteTransaction(t) {
  if (t.installment_total) {
    const choice = await confirmDialog(
      `Esta é a parcela ${t.installment_number}/${t.installment_total} de "${t.description}".`,
      "Excluir parcela",
      { yesLabel: "Só esta parcela", extraLabel: `Todas as ${t.installment_total} parcelas` }
    );
    if (!choice) return;
    const query = choice === "extra"
      ? supabase.from("transactions").delete().eq("installment_group", t.installment_group)
      : supabase.from("transactions").delete().eq("id", t.id);
    const { error } = await mutate(query);
    if (error) return;
    if (t.invoice_id) {
      cardTransactions = choice === "extra"
        ? cardTransactions.filter((x) => x.installment_group !== t.installment_group)
        : cardTransactions.filter((x) => x.id !== t.id);
      renderCardsGrid();
    }
    await refreshMonth();
    return;
  }
  if (!(await confirmDialog(`Excluir "${t.description}"?`, "Excluir lançamento"))) return;
  const { error } = await mutate(supabase.from("transactions").delete().eq("id", t.id));
  if (error) return;
  await refreshMonth();
}

async function refreshMonth() {
  await loadMonthTransactions();
  renderTxList();
  renderSummary();
  renderDonut();
}

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
