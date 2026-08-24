export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="h-control-lg w-full max-w-xs rounded-lg border border-border bg-surface px-3 text-text placeholder:text-muted focus:border-primary focus:outline focus:outline-2 focus:outline-primary/20"
      type="search"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
    />
  );
}
