import type { StorageProfileDetail, StorageProfileReadiness } from "./types";

const providerMessages: Record<string, string> = {
  B2_BUCKET_NOT_PUBLIC:
    "El bucket debe ser público para la entrega directa mediante Cloudflare.",
  B2_LIFECYCLE_MANUAL_REQUIRED:
    "NodeProx no pudo aplicar automáticamente la limpieza temporal. Revisa los permisos o aplica la configuración indicada.",
  B2_BROWSER_UPLOAD_PROBE_FAILED:
    "El navegador no pudo completar la carga directa al bucket.",
  CLOUDFLARE_DNS_CONFLICT:
    "Ese subdominio ya existe en Cloudflare y no pertenece a este perfil.",
  CLOUDFLARE_RULE_CAPACITY_EXHAUSTED:
    "No hay capacidad disponible para crear otra regla administrada en el plan actual.",
};

export function storageProfileErrorMessage(code: string | null | undefined) {
  if (!code) return "La operación no pudo completarse. Inténtalo de nuevo.";
  return (
    providerMessages[code] ??
    "La operación no pudo completarse. Consulta los detalles técnicos si necesitas soporte."
  );
}

export type StorageCapabilityPresentation = {
  allowed: string[];
  denied: string[];
};

export function projectStorageCapabilities(
  profile: StorageProfileDetail,
  readiness: StorageProfileReadiness | undefined,
): StorageCapabilityPresentation {
  if (profile.source === "env")
    return {
      allowed: [
        "Consultar estado",
        "Consultar preparación",
        ...(profile.status === "retired"
          ? ["Reactivar cuando el servidor lo permita"]
          : []),
      ],
      denied: ["Editar identidad B2", "Editar credenciales", "Eliminar perfil"],
    };
  if (profile.status === "active")
    return {
      allowed: ["Volver a comprobar proveedores", "Rotar credenciales"],
      denied: [
        "Editar identidad del proveedor",
        "Migrar media histórica",
        "Eliminar perfil",
      ],
    };
  if (profile.status === "retired")
    return {
      allowed: [
        "Seguir resolviendo media histórica",
        ...(readiness?.activation.eligible
          ? ["Reactivar cuando el servidor lo permita"]
          : []),
      ],
      denied: [
        "Reescribir el almacenamiento de objetos existentes",
        "Eliminar mientras existan referencias",
      ],
    };
  if (profile.cloudflareProvisioningStatus === "verified")
    return {
      allowed: [
        "Renombrar perfil",
        "Rotar credenciales",
        "Volver a comprobar proveedores",
        ...(readiness?.activation.eligible
          ? ["Activar si el servidor lo permite"]
          : []),
      ],
      denied: [
        "Cambiar endpoint, región o bucket",
        "Cambiar hostname",
        "Migrar media histórica",
      ],
    };
  return {
    allowed: [
      "Editar identidad del perfil",
      "Guardar o rotar credenciales",
      "Configurar o volver a comprobar B2",
      "Probar carga directa del navegador",
    ],
    denied: [
      "Activar antes de completar readiness",
      "Migrar media histórica",
      "Eliminar objetos históricos",
    ],
  };
}
