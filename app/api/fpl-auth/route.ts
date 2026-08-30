import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFpl } from "@/lib/fpl";

// Never statically cached — every call is a live login attempt.
export const dynamic = "force-dynamic";

interface FplAuthRequestBody {
  email?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  let body: FplAuthRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  try {
    const sessionCookie = await authenticateWithFpl(email, password);
    // Deliberately nothing else is logged or stored here — email/password
    // never appear in any log line, and this route holds no server-side
    // state at all; the session cookie is handed straight back to the
    // client to keep, not retained on our side.
    return NextResponse.json(
      { sessionCookie },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    // Generic message regardless of failure reason (wrong password vs wrong
    // email vs FPL being unreachable would otherwise let an attacker probe
    // which emails have accounts).
    const message = error instanceof Error && error.message.includes("Invalid FPL")
      ? error.message
      : "Could not sign in to FPL right now. Check your details and try again.";
    return NextResponse.json(
      { error: message },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
