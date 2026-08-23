import { ApiError } from "../../lib/api/types";

export function errorMessage(
  error: unknown,
  fallback = "No se pudo completar la operación.",
) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Tu sesión no es válida o ha expirado.";
    if (error.status === 403)
      return "No tienes permisos para realizar esta operación.";
    if (error.status === 404) return "El recurso solicitado no existe.";
    if (error.status === 409)
      return "La operación entra en conflicto con el estado actual.";
    if (error.status === 413) return "El archivo supera el límite permitido.";
    if (error.status === 415) return "Solo se aceptan archivos ZIP.";
    if (error.status === 422) return error.message;
    return error.message;
  }
  return fallback;
}
