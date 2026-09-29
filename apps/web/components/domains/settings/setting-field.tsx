import type { ProductSettingField as ProductField } from "../../../lib/domains/settings/types";
import { FieldShell } from "../../ui/field-shell";
import { Input } from "../../ui/input";

export function SettingField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: ProductField;
  value: string;
  error?: string | undefined;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `setting-${field.key}`;
  const describedBy = [
    field.description ? `${id}-description` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={disabled ? "rounded-control opacity-70" : undefined}>
      <FieldShell
        id={id}
        label={field.label}
        description={field.helpText || field.description}
        error={error}
        required
        disabled={disabled}
      >
        <div className="flex items-center gap-3">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            value={value}
            min={field.constraints?.min}
            max={field.constraints?.max}
            step={1}
            disabled={disabled || !field.editable}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className={`min-h-control w-full rounded-control border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-surface-hover read-only:cursor-default ${error ? "border-danger" : "border-border"}`}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="min-w-12 text-sm text-muted">{field.unit}</span>
        </div>
        <p className="m-0 text-xs text-muted">{field.impact}</p>
      </FieldShell>
    </div>
  );
}
