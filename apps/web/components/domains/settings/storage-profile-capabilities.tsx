import { Check, X } from "lucide-react";
import { projectStorageCapabilities } from "../../../lib/domains/storage-profiles/presentation";
import type {
  StorageProfileDetail,
  StorageProfileReadiness,
} from "../../../lib/domains/storage-profiles/types";
import { Card } from "../../ui/card";

export function StorageProfileCapabilities({
  profile,
  readiness,
}: {
  profile: StorageProfileDetail;
  readiness?: StorageProfileReadiness | undefined;
}) {
  const capabilities = projectStorageCapabilities(profile, readiness);
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="m-0 font-semibold">Capacidades del perfil</h3>
        <p className="mb-0 mt-1 text-sm text-muted">
          Resumen informativo; el servidor determina cada operación permitida.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="m-0 text-sm font-medium">Permitido</h4>
          <ul className="mt-2 space-y-2 p-0 text-sm">
            {capabilities.allowed.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-success"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="m-0 text-sm font-medium">No permitido</h4>
          <ul className="mt-2 space-y-2 p-0 text-sm text-muted">
            {capabilities.denied.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <X aria-hidden="true" className="mt-0.5 size-4 text-muted" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
