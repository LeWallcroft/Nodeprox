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
      className="search-input"
      type="search"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
    />
  );
}
