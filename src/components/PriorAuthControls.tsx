"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Printer } from "lucide-react";
import { Button, Select, Textarea } from "./ui";

const STATUSES = [
  ["draft", "Draft"],
  ["submitted", "Submitted to insurer"],
  ["approved", "Approved"],
  ["denied", "Denied"],
  ["appealed", "Appealed"],
] as const;

export function PriorAuthControls({ id, status, letter }: { id: string; status: string; letter: string }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(letter);
  const save = async (body: Record<string, unknown>) => {
    await fetch(`/api/prior-auth/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    router.refresh();
  };
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        Status
        <Select
          className="w-48 py-1.5"
          value={s}
          onChange={(e) => {
            setS(e.target.value);
            void save({ status: e.target.value });
          }}
        >
          {STATUSES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </label>
      <Button variant="secondary" onClick={() => setEditing((x) => !x)}>
        <Pencil size={14} /> {editing ? "Close editor" : "Edit letter"}
      </Button>
      <Button onClick={() => window.print()}>
        <Printer size={14} /> Print / save PDF
      </Button>
      {editing && (
        <div className="w-full">
          <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          <Button
            className="mt-2"
            onClick={async () => {
              await save({ letter: text });
              setEditing(false);
            }}
          >
            Save letter
          </Button>
        </div>
      )}
    </div>
  );
}
