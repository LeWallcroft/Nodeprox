import { apiRequestBrowser } from "../../api/browser";
import type {
  StorageProfileDetail,
  StorageProfileDraftInput,
  StorageProfileReadiness,
  StorageProfileSummary,
} from "./types";

const root = "/admin/storage/profiles";
const path = (id: string, suffix = "") =>
  `${root}/${encodeURIComponent(id)}${suffix}`;
const json = (value: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

export const listStorageProfiles = async () =>
  (await apiRequestBrowser<{ items: StorageProfileSummary[] }>(root)).items;
export const getStorageProfile = (id: string) =>
  apiRequestBrowser<StorageProfileDetail>(path(id));
export const getStorageReadiness = (id: string) =>
  apiRequestBrowser<StorageProfileReadiness>(path(id, "/readiness"));
export const createStorageProfile = (input: StorageProfileDraftInput) =>
  apiRequestBrowser<StorageProfileDetail>(root, json(input));
export const updateStorageProfile = (
  id: string,
  input: Partial<StorageProfileDraftInput>,
) =>
  apiRequestBrowser<StorageProfileDetail>(path(id), {
    ...json(input),
    method: "PATCH",
  });
export const rotateStorageCredentials = (
  id: string,
  input: { b2KeyId: string; b2ApplicationKey: string },
) =>
  apiRequestBrowser<StorageProfileDetail>(
    path(id, "/credentials"),
    json(input),
  );
export const runStorageAction = (
  id: string,
  action:
    | "b2/provision"
    | "b2/recheck"
    | "cloudflare/provision"
    | "cloudflare/recheck"
    | "activate",
) =>
  apiRequestBrowser<StorageProfileReadiness | StorageProfileDetail>(
    path(id, `/${action}`),
    { method: "POST" },
  );

type BrowserProbeStart = {
  probeId: string;
  grant: {
    mode: "single";
    method: "PUT";
    url: string;
    headers: Record<string, string>;
  };
  body: string;
  contentType: string;
};

/** The PUT deliberately goes straight from this browser to B2; a same-origin proxy would not test CORS. */
export async function runBrowserUploadProbe(
  id: string,
): Promise<StorageProfileReadiness> {
  const probe = await apiRequestBrowser<BrowserProbeStart>(
    path(id, "/browser-probe/start"),
    { method: "POST" },
  );
  if (probe.grant.mode !== "single") {
    try {
      await apiRequestBrowser<StorageProfileReadiness>(
        path(id, "/browser-probe/complete"),
        json({ probeId: probe.probeId, outcome: "client_failed" }),
      );
    } catch {
      throw new Error("No se pudo finalizar la verificación de carga B2.");
    }
    throw new Error("El modo de prueba de carga no está soportado.");
  }
  let outcome: "uploaded" | "client_failed" = "client_failed";
  let uploadFailed = false;
  let completion: Promise<StorageProfileReadiness> | null = null;
  try {
    const response = await fetch(probe.grant.url, {
      method: probe.grant.method,
      headers: probe.grant.headers,
      body: probe.body,
    });
    if (!response.ok) throw new Error("browser-upload-probe-failed");
    outcome = "uploaded";
  } catch {
    uploadFailed = true;
  } finally {
    completion = apiRequestBrowser<StorageProfileReadiness>(
      path(id, "/browser-probe/complete"),
      json({ probeId: probe.probeId, outcome }),
    );
  }
  let result: StorageProfileReadiness;
  try {
    result = await completion;
  } catch {
    throw new Error("No se pudo finalizar la verificación de carga B2.");
  }
  if (uploadFailed)
    throw new Error(
      "El navegador no pudo cargar directamente a B2. Revisa CORS y la conectividad.",
    );
  return result;
}
