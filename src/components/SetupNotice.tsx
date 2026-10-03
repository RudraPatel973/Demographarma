export function SetupNotice() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-xl font-semibold">Connect Supabase to get started</h1>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Create a Supabase project.</li>
        <li>
          In the SQL editor, run <code className="rounded bg-slate-100 px-1">supabase/migrations/0001_schema.sql</code>, then{" "}
          <code className="rounded bg-slate-100 px-1">supabase/seed.sql</code>.
        </li>
        <li>
          Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to <code className="rounded bg-slate-100 px-1">.env.local</code> and fill in{" "}
          <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="rounded bg-slate-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code>.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  );
}
