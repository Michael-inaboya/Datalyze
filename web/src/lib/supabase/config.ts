export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Newer Supabase projects call this the publishable key; older ones the anon key. Either works.
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Without Supabase settings the app still runs, with sign-in disabled and only the demo available. */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
