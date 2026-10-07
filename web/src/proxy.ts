import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/config";

// Keeps the Supabase session cookie fresh and sends signed-out visitors from the app to the sign-in page.
export async function proxy(request: NextRequest) {
  if (!supabaseConfigured) {
    return NextResponse.redirect(new URL("/demo", request.url));
  }
  let response = NextResponse.next({ request });
  const db = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*"],
};
