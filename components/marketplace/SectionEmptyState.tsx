export function SectionEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 py-8 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  );
}
