import {
  Activity,
  Archive,
  CheckCircle2,
  Database,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { ApiStatusCard } from "../../ui/api-status-card";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { StatusBadge } from "../../ui/status-badge";

const pendingChecks = [
  {
    label: "Aplicación web",
    description:
      "La verificación de despliegue se conectará al contrato de mantenimiento.",
    icon: Activity,
  },
  {
    label: "Worker de procesamiento",
    description: "Pendiente de health check y estado de cola administrable.",
    icon: Server,
  },
  {
    label: "Base de datos y migraciones",
    description:
      "Pendiente de endpoint de lectura; no se ejecutan migraciones desde la web.",
    icon: Database,
  },
  {
    label: "Almacenamiento B2 y cache",
    description:
      "Pendiente de validación server-side de bucket, CORS, lifecycle y origen de cache.",
    icon: HardDrive,
  },
];

const deploymentChecklist = [
  "Backup verificado antes de abrir la ventana de despliegue",
  "Migraciones revisadas y ejecutables por el procedimiento aprobado",
  "CORS, lifecycle y prefijos válidos comprobados para el bucket activo",
  "Rollback definido sin transferir ni eliminar objetos históricos",
];

export function MaintenancePanel() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ApiStatusCard />
        {pendingChecks.slice(0, 1).map(({ label, description, icon: Icon }) => (
          <Card
            key={label}
            className="p-5"
            aria-labelledby="maintenance-web-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-control bg-primary-soft text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                    Integración
                  </p>
                  <h3
                    id="maintenance-web-title"
                    className="m-0 text-lg font-semibold"
                  >
                    {label}
                  </h3>
                </div>
              </div>
              <StatusBadge label="Pendiente" tone="neutral" />
            </div>
            <p className="mb-0 mt-4 text-sm text-muted">{description}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5" aria-labelledby="maintenance-checks-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              Observabilidad
            </p>
            <h3
              id="maintenance-checks-title"
              className="m-0 mt-1 text-lg font-semibold"
            >
              Estado de servicios
            </h3>
            <p className="mb-0 mt-1 text-sm text-muted">
              Los estados que todavía no tienen API no se presentan como
              saludables.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled
            icon={<RefreshCw aria-hidden="true" className="size-4" />}
          >
            Actualizar estado
          </Button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {pendingChecks.slice(1).map(({ label, description, icon: Icon }) => (
            <div
              key={label}
              className="rounded-control border border-border bg-surface-elevated p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 place-items-center rounded-control bg-surface text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <StatusBadge label="Pendiente" tone="neutral" />
              </div>
              <h4 className="mb-0 mt-4 text-sm font-semibold">{label}</h4>
              <p className="mb-0 mt-1 text-xs leading-5 text-muted">
                {description}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5" aria-labelledby="maintenance-window-title">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-control bg-warning-soft text-warning">
              <Wrench aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3
                id="maintenance-window-title"
                className="m-0 text-lg font-semibold"
              >
                Ventana de mantenimiento
              </h3>
              <p className="mb-0 mt-1 text-sm text-muted">
                El modo de mantenimiento se habilitará cuando exista el contrato
                administrativo.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-control border border-border bg-surface-elevated p-3">
            <span className="flex items-center gap-2 text-sm text-muted">
              <LockKeyhole aria-hidden="true" className="size-4" />
              Acción protegida
            </span>
            <StatusBadge label="No disponible" tone="warning" />
          </div>
        </Card>

        <Card className="p-5" aria-labelledby="maintenance-backup-title">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-control bg-success-soft text-success">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3
                id="maintenance-backup-title"
                className="m-0 text-lg font-semibold"
              >
                Preparación de producción
              </h3>
              <p className="mb-0 mt-1 text-sm text-muted">
                Checklist operativo previo a migrar el despliegue.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-3 p-0 text-sm text-muted">
            {deploymentChecklist.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted">
            <Archive aria-hidden="true" className="size-4" />
            Las acciones destructivas y la migración de contenido no forman
            parte de esta vista.
          </div>
        </Card>
      </div>
    </div>
  );
}
