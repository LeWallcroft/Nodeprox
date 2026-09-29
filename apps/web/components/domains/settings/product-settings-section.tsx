"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProductSettingField,
  ProductSettings,
} from "../../../lib/domains/settings/types";
import {
  canSaveProductSettings,
  productSettingChanges,
  validateNumericSetting,
} from "../../../lib/domains/settings/validation";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { SettingField } from "./setting-field";

export function ProductSettingsSection({
  section,
  saving,
  saveError,
  onSave,
}: {
  section: ProductSettings["sections"][number];
  saving: boolean;
  saveError?: string | undefined;
  onSave: (
    changes: Array<{ key: string; value: number | boolean | string }>,
  ) => Promise<ProductSettings>;
}) {
  const serverValues = useMemo(
    () =>
      Object.fromEntries(
        section.fields.map((field) => [field.key, String(field.value)]),
      ),
    [section.fields],
  );
  const [baseline, setBaseline] = useState(serverValues);
  const [values, setValues] = useState(serverValues);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    setBaseline(serverValues);
    setValues(serverValues);
  }, [serverValues]);

  const errors = useMemo(
    () =>
      Object.fromEntries(
        section.fields.flatMap((field) => {
          const result = validateNumericSetting(values[field.key] ?? "", field);
          return result.valid ? [] : [[field.key, result.message]];
        }),
      ) as Record<string, string>,
    [section.fields, values],
  );
  const changes = productSettingChanges(section.fields, values, baseline);
  const dirty = section.fields.some(
    (field) => values[field.key] !== baseline[field.key],
  );
  const invalid = Object.keys(errors).length > 0;

  async function save() {
    setSaveMessage("");
    try {
      const response = await onSave(changes);
      const returned = new Map(
        response.sections.flatMap((item) =>
          item.fields.map((field) => [field.key, String(field.value)] as const),
        ),
      );
      const nextBaseline = Object.fromEntries(
        section.fields.map((field) => [
          field.key,
          returned.get(field.key) ?? values[field.key] ?? "",
        ]),
      );
      setBaseline(nextBaseline);
      setValues(nextBaseline);
      setSaveMessage("Configuración actualizada correctamente.");
    } catch {
      setSaveMessage("No se pudieron guardar los cambios. Inténtalo de nuevo.");
    }
  }

  return (
    <Card className="space-y-5 p-5">
      {section.fields.map((field: ProductSettingField) => (
        <SettingField
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          error={errors[field.key]}
          disabled={saving}
          onChange={(value) => {
            setSaveMessage("");
            setValues((current) => ({ ...current, [field.key]: value }));
          }}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {dirty ? (
          <span className="text-sm text-warning" role="status">
            Cambios sin guardar
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || saving}
            onClick={() => {
              setValues(baseline);
              setSaveMessage("");
            }}
          >
            Restablecer
          </Button>
          <Button
            disabled={
              !canSaveProductSettings({ dirty, invalid, pending: saving })
            }
            loading={saving}
            onClick={() => void save()}
          >
            Guardar cambios
          </Button>
        </div>
      </div>
      {saveError || saveMessage ? (
        <p
          className={`m-0 text-sm ${saveError ? "text-danger" : "text-success"}`}
          role={saveError ? "alert" : "status"}
        >
          {saveError || saveMessage}
        </p>
      ) : null}
    </Card>
  );
}
