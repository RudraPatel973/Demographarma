import "server-only";
import { NextResponse } from "next/server";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Wrap a route handler so thrown errors become JSON 500s with a readable message. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[api]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

/** Keep only the listed keys (for PATCH bodies). */
export function pick<T extends Record<string, unknown>>(obj: T, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
