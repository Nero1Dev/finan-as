// ============================================================
// Preencha com os dados do SEU projeto Supabase:
// Dashboard > Project Settings > API
// ============================================================
export const SUPABASE_URL = "https://wdlwrzvnfqkjxwxharyi.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkbHdyenZuZnFranh3eGhhcnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMzMzNDEsImV4cCI6MjEwMzcwOTM0MX0.-uFESI9q8reFek_QwczPV7RdfNDftTGTm6BlmdJ0pf8";

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
