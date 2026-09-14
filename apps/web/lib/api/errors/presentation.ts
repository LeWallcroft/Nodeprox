import { ApiError, type ProblemDetails } from "../types";

export type ErrorPresentation = {
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  presentation: "toast" | "inline" | "dialog";
  requestId?: string;
};

/** Presentation-only mapping. Feature components depend on stable codes, never `detail`. */
export function resolveErrorPresentation(error: unknown): ErrorPresentation {
  const details = error instanceof ApiError ? error.details : undefined;
  const code = details?.code;
  const requestId = details?.requestId;
  const known: Record<string, Omit<ErrorPresentation, "requestId">> = {
    "chapter-conflict": {
      title: "Conflicto de capítulo",
      message: "Ya existe un capítulo con ese número en esta serie.",
      severity: "warning",
      presentation: "inline",
    },
    "series-slug-conflict": {
      title: "Slug de serie en uso",
      message: "Ya existe una serie con el mismo slug canónico.",
      severity: "warning",
      presentation: "inline",
    },
    "series-slug-invalid": {
      title: "Título no válido para URL",
      message: "El título debe incluir letras o números que formen un slug.",
      severity: "warning",
      presentation: "inline",
    },
    "series-creation-grant-already-consumed": {
      title: "Autorización no disponible",
      message:
        "Esta autorización ya no está disponible. Selecciona otra autorización.",
      severity: "warning",
      presentation: "inline",
    },
    "series-creation-grant-invalidated": {
      title: "Autorización invalidada",
      message: "Esta autorización fue invalidada y ya no puede utilizarse.",
      severity: "warning",
      presentation: "inline",
    },
    "series-creation-grant-not-owned": {
      title: "Autorización no disponible",
      message: "La autorización seleccionada no está disponible.",
      severity: "warning",
      presentation: "inline",
    },
    "series-creation-grant-not-found": {
      title: "Autorización no disponible",
      message: "La autorización seleccionada no está disponible.",
      severity: "warning",
      presentation: "inline",
    },
    forbidden: {
      title: "Acción no permitida",
      message: "No tienes permisos para realizar esta operación.",
      severity: "warning",
      presentation: "inline",
    },
    "authorization-denied": {
      title: "Acción no permitida",
      message: "No tienes permisos para realizar esta operación.",
      severity: "warning",
      presentation: "inline",
    },
  };
  if (code && known[code])
    return { ...known[code], ...(requestId ? { requestId } : {}) };

  const category = details?.category;
  if (category === "validation" || category === "business_rule")
    return {
      title: "Revisa los datos ingresados",
      message:
        error instanceof ApiError
          ? error.message
          : "La solicitud no es válida.",
      severity: "warning",
      presentation: "inline",
      ...(requestId ? { requestId } : {}),
    };
  if (category === "internal" || category === "external_dependency")
    return {
      title: "No se pudo completar la operación",
      message:
        "Inténtalo nuevamente. Si el problema continúa, proporciona la referencia a soporte.",
      severity: "error",
      presentation: "toast",
      ...(requestId ? { requestId } : {}),
    };
  return {
    title: "No se pudo completar la operación",
    message:
      error instanceof ApiError ? error.message : "Inténtalo nuevamente.",
    severity: "error",
    presentation: "toast",
    ...(requestId ? { requestId } : {}),
  };
}

export function problemReference(problem?: ProblemDetails): string | undefined {
  return problem?.requestId;
}
