export type ProductSettingValue = number | boolean | string;

export type ProductSettingDefinition = {
  key: string;
  section: string;
  sectionLabel: string;
  label: string;
  description: string;
  unit: string;
  helpText: string;
  impact: string;
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
    label: "Espera para volver a colaborar",
    description:
      "Tiempo mínimo antes de volver a conceder colaboración en la misma serie.",
    unit: "días",
    helpText:
      "Tiempo mínimo antes de volver a conceder colaboración en la misma serie.",
    impact: "Cambia cuándo puede volver a concederse colaboración.",
    type: "number",
    editable: true,
    defaultValue: 7,
    constraints: { min: 0, max: 365 },
  },
  {
    key: "upload_warning_image_size_mb",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Avisar por imágenes pesadas",
    description:
      "Muestra una advertencia; no bloquea la carga ni modifica el archivo.",
    unit: "MB",
    helpText:
      "Muestra una advertencia; no bloquea la carga ni modifica el archivo.",
    impact: "Solo afecta advertencias en la interfaz.",
    type: "number",
    editable: true,
    defaultValue: 8,
    constraints: { min: 1, max: 128 },
  },
  {
    key: "upload_warning_width_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Avisar por ancho de imagen",
    description: "Solo advertencia. No redimensiona la imagen.",
    unit: "px",
    helpText: "Solo advertencia. No redimensiona la imagen.",
    impact: "Solo afecta advertencias en la interfaz.",
    type: "number",
    editable: true,
    defaultValue: 4000,
    constraints: { min: 1, max: 50000 },
  },
  {
    key: "upload_warning_height_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Avisar por altura de imagen",
    description: "Solo advertencia. No recorta ni redimensiona.",
    unit: "px",
    helpText: "Solo advertencia. No recorta ni redimensiona.",
    impact: "Solo afecta advertencias en la interfaz.",
    type: "number",
    editable: true,
    defaultValue: 12000,
    constraints: { min: 1, max: 100000 },
  },
  {
    key: "upload_max_image_size_mb",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Tamaño máximo de imagen",
    description: "Límite obligatorio por imagen admitida.",
    unit: "MB",
    helpText: "Rechaza imágenes individuales mayores a este valor.",
    impact: "Bloquea la admisión de archivos que excedan el límite.",
    type: "number",
    editable: true,
    defaultValue: 64,
    constraints: { min: 1, max: 64 },
  },
  {
    key: "upload_max_width_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Ancho máximo",
    description: "Límite obligatorio de ancho; 0 desactiva el límite.",
    unit: "px",
    helpText: "No se infiere desde los umbrales de advertencia.",
    impact: "Rechaza imágenes que superen el límite configurado.",
    type: "number",
    editable: true,
    defaultValue: 0,
    constraints: { min: 0, max: 50000 },
  },
  {
    key: "upload_max_height_px",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Altura máxima",
    description: "Límite obligatorio de altura; 0 desactiva el límite.",
    unit: "px",
    helpText: "No se infiere desde los umbrales de advertencia.",
    impact: "Rechaza imágenes que superen el límite configurado.",
    type: "number",
    editable: true,
    defaultValue: 0,
    constraints: { min: 0, max: 100000 },
  },
  {
    key: "upload_max_pixels",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Píxeles máximos",
    description: "Límite obligatorio de píxeles; 0 desactiva el límite.",
    unit: "px",
    helpText: "No se infiere desde los umbrales de advertencia.",
    impact: "Rechaza imágenes que superen el límite configurado.",
    type: "number",
    editable: true,
    defaultValue: 0,
    constraints: { min: 0, max: 500000000 },
  },
  {
    key: "upload_max_compression_ratio",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Relación máxima de compresión ZIP",
    description: "Límite por entrada; 0 desactiva el límite.",
    unit: "x",
    helpText:
      "Límite de seguridad independiente de dimensiones y advertencias.",
    impact: "Rechaza ZIP con relaciones de compresión superiores al valor.",
    type: "number",
    editable: true,
    defaultValue: 0,
    constraints: { min: 0, max: 1000 },
  },
  {
    key: "bulk_upload_concurrency",
    section: "uploads",
    sectionLabel: "Cargas",
    label: "Subidas ZIP simultáneas",
    description:
      "Máximo de cargas directas iniciadas por el navegador al mismo tiempo.",
    unit: "cargas",
    helpText:
      "Máximo de cargas directas iniciadas por el navegador al mismo tiempo.",
    impact:
      "Aumentarlo puede incrementar el uso simultáneo de red y navegador.",
    type: "number",
    editable: true,
    defaultValue: 3,
    constraints: { min: 1, max: 5 },
  },
];

export function findProductSettingDefinition(key: string) {
  return PRODUCT_SETTINGS_REGISTRY.find((definition) => definition.key === key);
}
