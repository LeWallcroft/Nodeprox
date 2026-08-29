export type ProductSettingValue = number | boolean | string;

export type ProductSettingDefinition = {
  key: string;
  section: string;
  sectionLabel: string;
  label: string;
  description: string;
  type: "number";
  editable: true;
  defaultValue: number;
  constraints: { min: number; max: number };
};

export const PRODUCT_SETTINGS_REGISTRY: readonly ProductSettingDefinition[] = [
  {
    key: "helper_cooldown_days",
    section: "collaboration",
    sectionLabel: "Colaboración",
    label: "Cooldown de colaboradores",
    description:
      "Días de espera antes de volver a conceder colaboración en la misma serie.",
    type: "number",
    editable: true,
    defaultValue: 7,
    constraints: { min: 0, max: 365 },
  },
  {
    key: "upload_warning_image_size_mb",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Advertir si imagen supera",
    description: "Umbral informativo; no bloquea la carga ni el procesamiento.",
    type: "number",
    editable: true,
    defaultValue: 8,
    constraints: { min: 1, max: 128 },
  },
  {
    key: "upload_warning_width_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Advertir si ancho supera",
    description: "Umbral informativo; no modifica la imagen.",
    type: "number",
    editable: true,
    defaultValue: 4000,
    constraints: { min: 1, max: 50000 },
  },
  {
    key: "upload_warning_height_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Advertir si altura supera",
    description: "Umbral informativo; no modifica la imagen.",
    type: "number",
    editable: true,
    defaultValue: 12000,
    constraints: { min: 1, max: 100000 },
  },
  {
    key: "bulk_upload_concurrency",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Subidas ZIP simultáneas",
    description:
      "Número máximo de cargas directas iniciadas desde el navegador.",
    type: "number",
    editable: true,
    defaultValue: 3,
    constraints: { min: 1, max: 5 },
  },
];

export function findProductSettingDefinition(key: string) {
  return PRODUCT_SETTINGS_REGISTRY.find((definition) => definition.key === key);
}
