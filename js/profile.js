import { supabase } from "./supabaseClient.js";

// Garante que existe uma linha em "profiles" pra este usuário (username -> email),
// usada tanto no cadastro/login normal quanto no primeiro login via Google.
export async function ensureProfile(user, username) {
  if (!user) return;
  const { data: existing } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (existing) return;
  const finalUsername = username || user.user_metadata?.username || user.user_metadata?.full_name?.replace(/\s+/g, "").toLowerCase() || user.email.split("@")[0];
  await supabase.from("profiles").insert({ id: user.id, username: finalUsername, email: user.email });
}
