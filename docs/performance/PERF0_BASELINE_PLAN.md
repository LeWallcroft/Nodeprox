# PERF-0 — Baseline de rendimiento Web/Cloud Core

## Propósito y límites

Capturar evidencia reproducible de navegación, SSR, API, consultas e imágenes antes de optimizar. PERF-0 añade observación opt-in con `PerformanceSampleV1` y `PerformanceObserverPort.record(sample): void`. No modifica caché, autorización, SQL, migraciones, estados, colas, outboxes, almacenamiento, B2, CDN ni DNS. No habilita PERF-1/2/3.

## Base y estado de esta entrega

- Base: `origin/main` en `e5aeb67` (`Merge pull request #82 from LeWallcroft/feat/opt1-worker-stage-telemetry`).
- Rama: `feat/perf0-web-cloud-baseline`.
- Evidencia de despliegue: no hay manifiesto de imagen ni digest de producción/staging adjunto al checkout; no atribuir mediciones de producción a este SHA.
- Staging y credenciales E2E: no disponibles en el checkout. No se ejecutaron requests contra producción ni se guardaron credenciales.
- Estado de baseline: inventario estático reproducible; los percentiles y comparación ON/OFF requieren ejecución controlada en staging y se dejan explícitamente pendientes.

## Instrumentación preparada

- API usa reloj monotónico, rutas cerradas, muestreo y un adapter best-effort sin consultas ni exportación remota. Flag: `NODEPROX_API_PERF_ENABLED=false`; sample rate entre 0 y 1.
- Web registra LCP, p98 de hasta 256 interacciones (INP estimado), CLS por ventana de sesión, long tasks, TTFB inicial y transferencias de recursos `<img>`. Flag: `NEXT_PUBLIC_NODEPROX_WEB_PERF_ENABLED=false`.
- La flag `NEXT_PUBLIC_*` se fija al compilar Next; `NODEPROX_WEB_PERF_ENABLED` es una flag de runtime para el servidor SSR.
- Las muestras se emiten como campos allowlisted en logs locales (`performance.sample`) cuando se activa la flag. No se agrega endpoint público ni persistencia de analítica.
- El Worker existente ya tiene `PerformanceObserverPort`, `noop`, `measureStage` monotónico y agregación acotada por ejecución. PERF-0 no altera jobs Worker.
- `request-context.ts` ya ejecuta el UPDATE de `audit_logs` existente. Es medición/auditoría preexistente y permanece intacta; PERF-0 no añade escrituras.
- El tiempo SSR implementado mide el bootstrap sesión/capacidades del layout protegido; no equivale al render completo de Next.
- El tiempo HTTP incluye el efecto de las consultas, pero no las separa por sentencia SQL: el contrato PERF-0 no tiene stage DB y añadir un hook global de query alteraría la capa de persistencia fuera del alcance. La duración SQL por query queda como gap de observabilidad para ADR/revisión separado.

## Procedimiento reproducible

1. Usar imagen y datos sintéticos de staging; registrar SHA Git, digest de cada imagen, navegador/versión, dispositivo, SO, región, build, configuración de red y fecha UTC en el artefacto de ejecución. Excluir health checks del conjunto de usuario.
2. Fijar dataset (series, capítulos y conjunto de imágenes), concurrencia, calentamiento y duración. No usar incidente/capítulo 97 como fixture de rendimiento.
3. Ejecutar cada flujo al menos 30 veces por perfil de navegador y modo telemetría OFF/ON, con la misma imagen, datos, red y configuración. Reportar p50/p95/p99 y dispersión; para métricas de navegador reportar también mediana y percentil 75 cuando la muestra lo permita.
4. Capturar trazas DevTools/HAR saneadas y export de logs de métricas. Borrar URL completa, query strings, cookies, headers de autorización, IDs, nombres de archivo y cuerpos antes de compartir.
5. En ON/OFF comparar respuestas, status, headers, conteo de requests y resultados funcionales. Revisar overhead de medición y confirmar cero escrituras SQL adicionales.
6. Adjuntar un reporte con resultados, configuración, fallos, limitaciones y digest de imágenes. No inferir causación comparando deployments con imágenes/SHAs desconocidos.

## Flujos de E2E

- Series: abrir listado, navegar a una serie, revisar detalle y volver. Medir navegación/TTFB, requests de API y render/interacción.
- Capítulos: abrir capítulos de una serie y cambiar paginación/filtros disponibles. Medir requests por acción, latencia API y render.
- Imágenes: abrir imágenes de un capítulo sintético y dejar cargar recursos. Medir requests, bytes transferidos reportados por navegador, duración por recurso y long tasks. No medir ni cambiar CDN/B2.

Ejecutar desktop y viewport móvil. Repetir sin telemetría y con flags explícitas. Las pruebas deben verificar equivalencia de comportamiento además de recolectar tiempos.

## Gates y salida

Requeridos para cerrar PERF-0: unit, integration, E2E en staging, typecheck/lint/build pertinentes, comparación ON/OFF, evidencia de auditoría/request id y ausencia de escrituras adicionales, SHA/digests correlacionados y baseline poblado. Sin staging/digests, la salida es incompleta y no constituye Go para PERF-1.

No hacer merge, tag ni despliegue automático. El PR queda para revisión humana.

## Quality gates ejecutados en preparación

- `pnpm test`: 213 archivos, 1109 pruebas pasan.
- `pnpm packages:build`: pasa.
- `pnpm build`: pasa (incluye builds de Web, API y Worker).
- Typecheck API y Web: pasan.
- `pnpm lint`: pasa con un warning preexistente en `apps/web/components/ui/searchable-combobox.test.tsx:44` (`noTemplateCurlyInString`).
- E2E PERF-0 OFF y ON: 1/1 pasa por modo en la ruta pública `/login`, con `E2E_EXTERNAL_BACKEND=true`; valida equivalencia del flujo público y presencia/ausencia del log local. No cubre Series/Chapters/Images autenticadas.
- `pnpm test:integration`: en ejecución paralela, 38/39 archivos y 293/294 pruebas; falló una expectativa de conteo en `domain-event-outbox-dispatcher.test.ts` por un evento compartido concurrente. La prueba aislada pasó 14/14 y la suite serial completa (`--no-file-parallelism`) pasó 39/39 archivos, 294/294 pruebas.
- No se generó reporte de p50/p95/p99 ni overhead real: falta staging autenticado, dataset estable y digest de imagen desplegada.
