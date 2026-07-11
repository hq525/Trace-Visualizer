import { useState } from "react";

export function PasteBox({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="board flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-[760px]">
        <h1 className="mb-1 text-xl font-semibold">Paste a stack trace</h1>
        <p className="mb-4 text-[13px] text-[var(--muted)]">
          Raw tracebacks, JSON logs, k8s/CI output — anything. crashpath finds the trace and maps it
          onto this repo. Everything stays on your machine.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Traceback (most recent call last):\n  File "app.py", line 12, in …'}
          spellCheck={false}
          className="mono h-[320px] w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--node-edge)]"
        />
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            disabled={text.trim().length === 0}
            onClick={() => onSubmit(text)}
            className="rounded-md bg-[var(--hot)] px-5 py-2 font-semibold text-[#1a0508] disabled:opacity-40"
          >
            Map this trace
          </button>
          <span className="mono text-[12px] text-[var(--faint)]">
            or pipe it in: pytest 2&gt;&amp;1 | npx crashpath
          </span>
        </div>
      </div>
    </div>
  );
}
