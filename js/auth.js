import { supabase } from "./supabaseClient.js";

const form = document.getElementById("authForm");
const msg = document.getElementById("authMsg");
const submitBtn = document.getElementById("authSubmit");
const modeToggle = document.getElementById("modeToggle");
const title = document.getElementById("authTitle");

let mode = "login"; // "login" | "signup"

function showMsg(text, type = "error") {
  msg.textContent = text;
  msg.className = `auth-msg show ${type}`;
}

function clearMsg() {
  msg.className = "auth-msg";
}

// se já tem sessão, vai direto pro app
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "app.html";
});

modeToggle.addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "signup" : "login";
  title.textContent = mode === "login" ? "Entrar" : "Criar conta";
  submitBtn.textContent = mode === "login" ? "Entrar" : "Criar conta";
  modeToggle.textContent = mode === "login" ? "Criar uma conta" : "Já tenho conta";
  clearMsg();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMsg();
  submitBtn.disabled = true;
  submitBtn.textContent = "...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "app.html";
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      showMsg("Conta criada. Verifique seu e-mail se a confirmação estiver ativada, ou já tente entrar.", "info");
    }
  } catch (err) {
    showMsg(traduzErro(err.message));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "login" ? "Entrar" : "Criar conta";
  }
});

function traduzErro(m) {
  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(m)) return "Este e-mail já tem conta. Faça login.";
  if (/password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  return m;
}
