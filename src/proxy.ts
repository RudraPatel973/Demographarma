import { NextResponse, type NextRequest } from "next/server";

/**
 * Site-wide password (HTTP Basic auth) for the demo deployment.
 * Set DEMO_PASSWORD (and optionally DEMO_USER, default "doctor"). Unset = no gate (local dev).
 * Left open on purpose: Photon's webhook and the patient's phone page (linked from the SMS).
 */
export function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.DEMO_USER || "doctor";

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Demographarma", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/photon/webhook|patient/).*)"],
};
