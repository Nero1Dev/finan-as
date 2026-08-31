import { supabase } from "./supabaseClient.js";
import { ensureProfile } from "./profile.js";

const form = document.getElementById("authForm");
const msg = document.getElementById("authMsg");
const submitBtn = document.getElementById("authSubmit");
const modeToggle = document.getElementById("modeToggle");

const usernameField = document.getElementById("usernameField");
const usernameInput = document.getElementById("username");
const identifierInput = document.getElementById("identifier");
const identifierLabel = document.getElementById("identifierLabel");

const passwordInput = document.getElementById("password");
const togglePasswordBtn = document.getElementById("togglePassword");
const pwStrengthWrap = document.getElementById("pwStrengthWrap");
const pwStrengthLabel = document.getElementById("pwStrengthLabel");
const pwSegs = document.querySelectorAll("#pwStrengthWrap .seg");

const confirmField = document.getElementById("confirmField");
const confirmInput = document.getElementById("confirmPassword");
const toggleConfirmBtn = document.getElementById("toggleConfirmPassword");

let mode = "login"; // "login" | "signup"

// ---------- MOSTRAR/OCULTAR SENHA ----------
function wireToggle(btn, input) {
  btn.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "MOSTRAR" : "OCULTAR";
  });
}
wireToggle(togglePasswordBtn, passwordInput);
wireToggle(toggleConfirmBtn, confirmInput);

// ---------- FORÇA DA SENHA ----------
function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

// mesma regra exigida no Supabase: minimo 8, com minuscula + maiuscula + numero
function passwordMeetsPolicy(pw) {
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}
const STRENGTH_LABELS = ["", "Fraca", "Razoável", "Boa", "Forte"];

passwordInput.addEventListener("input", () => {
  if (mode !== "signup") return;
  const pw = passwordInput.value;
  pwStrengthWrap.classList.toggle("open", pw.length > 0);
  const score = passwordStrength(pw);
  pwSegs.forEach((seg, i) => {
    seg.className = "seg" + (i < score ? ` lvl${score}` : "");
  });
  pwStrengthLabel.textContent = pw.length ? STRENGTH_LABELS[score] : "";
  checkMatch();
});
confirmInput.addEventListener("input", checkMatch);

function checkMatch() {
  if (mode !== "signup" || !confirmInput.value) {
    confirmInput.classList.remove("mismatch");
    return;
  }
  confirmInput.classList.toggle("mismatch", confirmInput.value !== passwordInput.value);
}

// ---------- MENSAGENS ----------
function showMsg(text, type = "error") {
  msg.textContent = text;
  msg.className = `auth-msg show ${type}`;
  if (type === "error") {
    msg.classList.remove("shake");
    void msg.offsetWidth;
    msg.classList.add("shake");
  }
}
function clearMsg() {
  msg.className = "auth-msg";
}

// já logado? vai direto pro app
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "app.html";
});

// ---------- ALTERNAR LOGIN / CRIAR CONTA ----------
modeToggle.addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "signup" : "login";
  applyMode();
});

function applyMode() {
  const isSignup = mode === "signup";
  usernameField.classList.toggle("open", isSignup);
  usernameInput.required = isSignup;
  confirmField.classList.toggle("open", isSignup);
  confirmInput.required = isSignup;
  pwStrengthWrap.classList.toggle("open", isSignup && passwordInput.value.length > 0);

  identifierLabel.textContent = isSignup ? "E-mail" : "E-mail ou usuário";
  identifierInput.type = isSignup ? "email" : "text";
  identifierInput.autocomplete = isSignup ? "email" : "username";

  submitBtn.textContent = isSignup ? "Criar conta" : "Entrar";
  modeToggle.textContent = isSignup ? "Já tenho conta" : "Criar uma conta";
  clearMsg();
}
applyMode();

// ---------- LOGIN: RESOLVER USUÁRIO -> E-MAIL ----------
async function resolveLoginEmail(identifier) {
  if (identifier.includes("@")) return identifier;
  const { data } = await supabase.from("profiles").select("email").eq("username", identifier).maybeSingle();
  return data?.email || null;
}

// ---------- LOGIN COM GOOGLE ----------
document.getElementById("googleBtn").addEventListener("click", async () => {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/app.html` },
  });
});

// ---------- SUBMIT ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMsg();

  const password = passwordInput.value;

  if (mode === "signup") {
    const username = usernameInput.value.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      showMsg("Usuário deve ter de 3 a 20 letras, números ou _.");
      return;
    }
    if (!passwordMeetsPolicy(password)) {
      showMsg("A senha precisa ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.");
      return;
    }
    if (password !== confirmInput.value) {
      showMsg("As senhas não coincidem.");
      confirmInput.classList.add("mismatch");
      return;
    }
  }

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");

  try {
    if (mode === "login") {
      const identifier = identifierInput.value.trim();
      const email = await resolveLoginEmail(identifier);
      if (!email) throw new Error("Usuário ou e-mail não encontrado.");
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await ensureProfile(data.user);
      window.location.href = "app.html";
    } else {
      const email = identifierInput.value.trim();
      const username = usernameInput.value.trim();

      const { data: existing } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      if (existing) throw new Error("Esse nome de usuário já está em uso.");

      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw error;

      if (data.session) {
        await ensureProfile(data.user, username);
        window.location.href = "app.html";
      } else {
        showMsg("Conta criada! Verifique seu e-mail para confirmar antes de entrar.", "info");
      }
    }
  } catch (err) {
    showMsg(traduzErro(err.message));
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
});

function traduzErro(m) {
  if (/invalid login credentials/i.test(m)) return "Usuário/e-mail ou senha incorretos.";
  if (/user already registered/i.test(m)) return "Este e-mail já tem conta. Faça login.";
  if (/password should be at least/i.test(m)) return "A senha precisa ter pelo menos 8 caracteres.";
  if (/should contain at least one character of each/i.test(m)) return "A senha precisa ter letra maiúscula, minúscula e número.";
  if (/duplicate key value/i.test(m)) return "Esse nome de usuário já está em uso.";
  if (/email address .* is invalid/i.test(m)) return "Esse e-mail não é válido.";
  return m;
}
