# PERF-0 — Matriz de medición

| Capa | Señales | Segmentación segura | Evidencia/estado |
| --- | --- | --- | --- |
| Navegación | TTFB (`browser.navigation.ttfb`), LCP, INP, CLS | Plantilla de ruta allowlisted, bucket UTC por minuto, outcome | Instrumentación web opt-in. TTFB inicial; navegación cliente posterior aún requiere captura E2E/DevTools. |
| SSR / bootstrap | duración monotónica del bloque sesión/capacidades (`ssr.bootstrap.duration`), llamadas bootstrap y reintentos | `/dashboard`, outcome | Observer SSR opt-in. No representa el render completo de Next. Completar con trazas E2E de navegación en staging. |
| API HTTP | duración monotónica por request, status class, abort | ruta Fastify conocida; fallback `/api/other`; sample rate | Observer opt-in. Sin ID, actor, IP, query, URL sin plantilla, auth ni body. |
| Consultas | requests por interacción; duración/status por API; caché Query solo como conteo/refetch | flujo y plantilla allowlisted, GET/POST por análisis externo | DevTools/HAR saneado. No instrumentar hooks que introduzcan requests, no cambiar cache policy. |
| Interacción/render | INP aproximado, long tasks, número de requests por acción | flujo sintético/ruta | Observer nativo browser; correlación de una interacción concreta se completa con Playwright trace en staging. |
| Imágenes | duración de recurso, `transferSize` si disponible, conteo de `<img>` | plantilla de página; agregación por flujo | Observer `resource`; transferSize puede ser cero por caché/TAO. Verificar contra panel DevTools sin cambiar CDN/B2. |
| DB/auditoría | costo preexistente de `UPDATE audit_logs` por respuesta; efecto agregado dentro de latencia API | experimento controlado en staging, misma carga | No modificar `request-context.ts`; verificar conteos SQL por ventana antes/después y mismo resultado auditado. No hay medición separada por sentencia SQL en PERF-0. |
| Worker | etapas de procesamiento ya instrumentadas | resumen existente por tipo de job | Fuera del alcance de cambios; observar logs existentes como contexto, sin variar worker/outbox. |

## Rutas objetivo

| Flujo | UI | API candidata |
| --- | --- | --- |
| Series | `/series`, `/series/:seriesId` | `/api/series`, `/api/series/:seriesId` |
| Capítulos | `/series/:seriesId/chapters` | `/api/series/:seriesId/chapters` |
| Imágenes | `/series/:seriesId/chapters/:chapterId/images` | `/api/chapters/:chapterId/images` |

Confirmar las rutas concretas desde las trazas de la versión ensayada; las métricas solo admiten catálogo cerrado y fallback genérico.

## Estadística y tabla de resultados

Informar `n`, p50, p95, p99 (requests/servidor), p75 y mediana para Web Vitals, conteo de requests por interacción, bytes de imagen y conteo de long tasks. Separar local/staging/prod; separar healthcheck de tráfico real. No mezclar navegadores, red, imágenes, dataset o SHAs.

| Entorno/SHA/digest | Flujo | Perfil | Telemetría | n | p50 | p95 | p99 | Requests/acción | Bytes img | Observaciones |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Pendiente: staging y digest no disponibles | Series/Capítulos/Imágenes | Desktop/Móvil | OFF/ON | — | — | — | — | — | — | No se ejecutó contra prod |
