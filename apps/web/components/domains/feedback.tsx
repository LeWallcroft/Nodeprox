import { ApiError } from "../../lib/api/types";
import { resolveErrorPresentation } from "../../lib/api/errors/presentation";

export function errorMessage(
  error: unknown,
  fallback = "No se pudo completar la operación.",
) {
  const presentation = resolveErrorPresentation(error);
  if (error instanceof ApiError) {
    const reference = presentation.requestId
      ? ` Referencia: ${presentation.requestId}`
      : "";
    if (error.code === "chapter-conflict")
      return `${presentation.message}${reference}`;
    if (error.status === 401) return "Tu sesión no es válida o ha expirado.";
    if (error.status === 403)
      return "No tienes permisos para realizar esta operación.";
    if (error.status === 404) return "El recurso solicitado no existe.";
    if (error.status === 409)
      return "La operación entra en conflicto con el estado actual.";
    if (error.status === 413) return "El archivo supera el límite permitido.";
    if (error.status === 415) return "Solo se aceptan archivos ZIP.";
    if (error.status === 422) return error.message;
    if (error.status >= 500) return `${presentation.message}${reference}`;
    return `${error.message}${reference}`;
  }
  return fallback;
}
