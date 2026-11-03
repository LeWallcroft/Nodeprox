# PERF-0 — Matriz de medición

| Capa | Señales | Segmentación segura | Evidencia/estado |
| --- | --- | --- | --- |
| Navegación | TTFB de documento, LCP, INP, CLS | Plantilla allowlisted; `navigationKind=document|spa`; bucket UTC por minuto | `web-vitals` oficial. Core Web Vitals de documento se etiquetan `document`; soft navigations solo donde `web-vitals`/Chromium lo soporten y se etiquetan `spa`. TTFB no se emite en SPA. |
| SSR / bootstrap | duración monotónica del bloque sesión/capacidades (`ssr.bootstrap.duration`), llamadas bootstrap y reintentos | `/dashboard`, outcome | Observer SSR opt-in. No representa el render completo de Next. Completar con trazas E2E de navegación en staging. |
| API HTTP | `http.request.duration` en ms; clase HTTP cerrada (`1xx`…`5xx`) | ruta Fastify conocida; fallback `/api/other`; sample rate | Muestra no incluye método ni status crudo, requestId/originRequestId, actor, IP, query, URL, auth ni body. HAR saneado es la fuente externa para método y conteo por método. |
| Consultas | requests por interacción; duración/status por API; caché Query solo como conteo/refetch | flujo y plantilla allowlisted | DevTools/HAR saneado; GET/POST se clasifican en esa evidencia externa, no en `PerformanceSampleV1`. No instrumentar hooks que introduzcan requests ni cambiar cache policy. |
| Interacción/render | INP oficial en ms; long tasks en ms | flujo sintético/ruta; `navigationKind` | `web-vitals` oficial, sin estimador INP propio. Conteo y correlación de requests por acción se completan con Playwright trace/HAR saneado en staging. |
| Imágenes | duración del recurso en ms; `transferSize` en bytes si disponible | plantilla de página; `navigationKind`; buffer de emisión limitado | Observer `resource`; solo entradas de tipo `<img>`. `transferSize` puede ser cero por caché/TAO. Límite local: una emisión por documento, máximo 64 muestras; excedentes contados como `dropped`. Verificar con DevTools sin cambiar CDN/B2. |
| DB/auditoría | costo preexistente de `UPDATE audit_logs` por respuesta; efecto agregado dentro de latencia API | experimento controlado en staging, misma carga | No modificar `request-context.ts`; verificar conteos SQL por ventana antes/después y mismo resultado auditado. No hay medición separada por sentencia SQL en PERF-0. |
| Worker | etapas de procesamiento ya instrumentadas | resumen existente por tipo de job | Fuera del alcance de cambios; observar logs existentes como contexto, sin variar worker/outbox. |

## Rutas objetivo

| Flujo | UI | API candidata |
| --- | --- | --- |
| Series | `/series`, `/series/:seriesId` | `/api/series`, `/api/series/:seriesId` |
| Capítulos | `/series/:seriesId/chapters` | `/api/series/:seriesId/chapters` |
| Imágenes | `/series/:seriesId/chapters/:chapterId/images` | `/api/chapters/:chapterId/images` |

Confirmar las rutas concretas desde las trazas de la versión ensayada; las métricas solo admiten catálogo cerrado y fallback genérico. Las rutas dinámicas y URLs completas nunca se emiten. Para recursos/long tasks, el observer se reemplaza al cambiar el pathname SPA; las señales de documento permanecen separadas y no se vuelven a instalar en cada ruta. Las muestras de las transiciones se guardan en un solo buffer por documento y se emiten una vez en `pagehide`/`hidden`.

## Estadística y tabla de resultados

Informar `n`, p50, p95, p99 (requests/servidor), p75 y mediana para Web Vitals, conteo de requests por interacción, bytes de imagen y conteo de long tasks. Separar local/staging/prod; separar healthcheck de tráfico real. No mezclar navegadores, red, imágenes, dataset o SHAs.

| Entorno/SHA/digest | Flujo | Perfil | Telemetría | n | p50 | p95 | p99 | Requests/acción | Bytes img | Observaciones |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-11-03: BLOQUEADO, sin staging aislado/dataset/credenciales/digests verificables | Series/Capítulos/Imágenes | Desktop/Móvil | OFF/ON | — | — | — | — | — | — | Sin baseline; no se accedió a producción. Preflight y aprovisionamiento propuesto en `PERF0_BASELINE_PLAN.md`. |

## Semántica del contrato y gaps

- `value` se discrimina por `metric`: `ms` para duraciones, `bytes` entero no negativo para transferencia, `score` para CLS. El validador runtime rechaza unidades/etapas incompatibles y propiedades no permitidas.
- `httpStatusClass` es el único campo HTTP adicional al común. El hook de rendimiento `onResponse` se registra después del hook de contexto/auditoría; por ello su duración observada puede incluir el trabajo previo del `UPDATE audit_logs`. No se cambia ni omite la auditoría. Esta muestra no equivale exactamente al TTFB visto por el navegador.
- `NEXT_PUBLIC_NODEPROX_WEB_PERF_ENABLED` es build-time: OFF/ON reproducible requiere dos artefactos construidos del mismo commit, registrar build args/config y ambos digests. `NODEPROX_WEB_PERF_ENABLED` (SSR) y `NODEPROX_API_PERF_ENABLED` son runtime. Los tres permanecen apagados por defecto.
- El E2E de navegación local simula transiciones `history.pushState` y recursos para comprobar plantilla/atribución y ausencia de IDs/query; no reemplaza la prueba autenticada en staging de la UI real ni aporta percentiles de producto.
- No se mide duración individual SQL ni el render SSR completo de Next. El costo de SQL de cada sentencia y las trazas de navegación autenticada quedan como trabajo de evidencia/staging, fuera de este contrato.

## Preflight de ejecución autenticada

| Control | Resultado al 2026-11-03 | Evidencia/acción requerida |
| --- | --- | --- |
| Environment privado de staging | No identificado en el endpoint de environments del repo | Crear environment privado con acceso aprobado y revisar aislamiento de DB, colas y storage |
| URL, versiones y digests desplegados | No disponibles en checkout/PR | Registrar SHA, runtime/browser, región/red y digest por servicio/build |
| Cuentas E2E y permisos | No disponibles; no se imprimieron valores secretos | Crear cuentas sintéticas de mínimo privilegio y cubrir revocación, 401 y 403 |
| Dataset Series/Chapters/Images | No disponible para este entorno | Generar fixture sintético con imágenes no sensibles; prohibido usar datos productivos o capítulo 97 |
| OFF/ON comparable | No ejecutado en staging | Dos builds del mismo SHA para la flag browser; runtime flags API/SSR controladas por corrida; documentar ambos digests |
| Escrituras SQL de telemetría | Sin ensayo staging | Comparar conteos en ventanas iguales y atribuir cero escrituras nuevas a la observación; preservar UPDATE de auditoría existente |

**Decisión:** NO-GO para cerrar PERF-0 y para comenzar PERF-1 hasta que haya staging aislado y se complete la matriz OFF/ON con trazas saneadas. Los quality gates de GitHub confirman CI, no sustituyen este baseline.
