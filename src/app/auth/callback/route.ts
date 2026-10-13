import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSafeRedirect } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const error = requestUrl.searchParams.get("error");
  const errorCode = requestUrl.searchParams.get("error_code");
  const errorDescription = requestUrl.searchParams.get("error_description");

  const safeNext = getSafeRedirect(next);

  // CEO CRM policy:
  // Password recovery/change through public auth links is disabled.
  // Any callback that tries to continue to /reset-password is rejected.
  if (safeNext.startsWith("/reset-password")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Friendly handling for expired or invalid auth links.
  if (
    errorCode === "otp_expired" ||
    error === "access_denied" ||
    (errorDescription &&
      errorDescription.toLowerCase().includes("expired"))
  ) {
    return NextResponse.redirect(
      new URL("/login?error=expired", request.url)
    );
  }

  // Preserve normal non-recovery Supabase auth callbacks.
  if (code) {
    let response = NextResponse.redirect(
      new URL(safeNext, request.url)
    );

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );

            response = NextResponse.redirect(
              new URL(safeNext, request.url)
            );

            cookiesToSet.forEach(
              ({ name, value, options }) =>
                response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.warn(
        "[auth/callback] exchangeCodeForSession failed:",
        exchangeError.message
      );

      return NextResponse.redirect(
        new URL("/login?error=expired", request.url)
      );
    }

    return response;
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
