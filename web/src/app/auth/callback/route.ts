import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/config";

// Email confirmation and password-reset links land here with a one-time code.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/app";
  const target = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/app", request.url);
  const response = NextResponse.redirect(target);
  if (!supabaseConfigured || !code) return response;
  const db = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=link", request.url));
  return response;
}
