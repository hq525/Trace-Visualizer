export function Legend() {
  return (
    <div className="ml-auto flex items-center gap-5 text-[12px] text-[var(--muted)]">
      <span className="flex items-center gap-2">
        <i className="inline-block w-[22px] border-t-[3px] rounded border-[var(--hot)]" />
        runtime trace
      </span>
      <span className="flex items-center gap-2">
        <i className="inline-block w-[22px] border-t-[3px] rounded border-[var(--static)]" />
        static call / import
      </span>
      <span className="flex items-center gap-2">
        <i className="inline-block w-[22px] border-t-[3px] rounded border-dashed border-[var(--ghost)]" />
        ghost — dynamic dispatch
      </span>
      <span className="flex items-center gap-2">
        <i className="inline-block h-[10px] w-[14px] rounded-[3px] border-[1.5px] border-[var(--faint)]" />
        containment by grouping
      </span>
    </div>
  );
}
