import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
