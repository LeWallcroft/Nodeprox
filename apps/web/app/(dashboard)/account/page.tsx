"use client";

import {
  Blocks,
  KeyRound,
  LockKeyhole,
  Mail,
  Monitor,
  Save,
  Settings2,
  ShieldCheck,
  Unplug,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { DiscordLinkSection } from "../../../components/domains/discord/discord-link-section";
import { errorMessage } from "../../../components/domains/feedback";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { StatusBadge } from "../../../components/ui/status-badge";
import {
  useChangePassword,
  usePreferences,
  useProfile,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdatePreferences,
  useUpdateProfile,
} from "../../../lib/domains/account/hooks";

type AccountTab =
  | "profile"
  | "security"
  | "preferences"
  | "sessions"
  | "integrations";

const tabs: ReadonlyArray<{
  id: AccountTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "profile", label: "Información personal", icon: UserRound },
  { id: "security", label: "Seguridad", icon: LockKeyhole },
  { id: "preferences", label: "Preferencias", icon: Settings2 },
  { id: "sessions", label: "Sesiones", icon: Monitor },
  { id: "integrations", label: "Integraciones", icon: Blocks },
];

export default function AccountPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const preferences = usePreferences();
  const update = useUpdateProfile();
  const updatePreferences = useUpdatePreferences();
  const password = useChangePassword();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [displayName, setDisplayName] = useState("");
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });

  if (profile.isPending) return <LoadingState label="Cargando perfil" />;
  if (profile.isError || !profile.data) {
    return (
      <ErrorState
        title="No se pudo cargar tu perfil"
        description={errorMessage(profile.error)}
        action={
          <Button onClick={() => void profile.refetch()}>Reintentar</Button>
        }
      />
    );
  }

  const user = profile.data;
  const visibleName =
    displayName || user.displayName || user.discordUsername || user.email;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Mi perfil"
        description="Gestiona tu información personal, seguridad y conexiones de tu cuenta."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Perfil", current: true },
        ]}
      />

      <section className="flex min-w-0 items-center gap-4 rounded-panel border border-[var(--border-subtle)] bg-surface p-5 shadow-card">
        <div className="grid size-16 shrink-0 place-items-center rounded-full bg-primary text-xl font-semibold text-primary-foreground shadow-card">
          {visibleName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate text-xl font-semibold">
              {visibleName}
            </h2>
            <StatusBadge label={roleLabel(user.role)} tone="neutral" />
          </div>
          <p className="m-0 truncate text-sm text-secondary">{user.email}</p>
          <p className="mt-1 mb-0 text-xs text-secondary">
            <span className="mr-1 text-success">●</span>
            {user.status === "active" ? "Cuenta activa" : user.status}
            <span className="mx-2 text-muted">·</span>
            Miembro desde {formatDate(user.createdAt)}
          </p>
        </div>
      </section>

      <div className="border-b border-[var(--border-subtle)]">
        <div
          aria-label="Secciones del perfil"
          className="flex max-w-full overflow-x-auto"
          role="tablist"
        >
          {tabs.map(({ id, label, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                aria-controls={`account-panel-${id}`}
                aria-selected={selected}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "border-primary text-text" : "border-transparent text-secondary hover:text-text"}`}
                id={`account-tab-${id}`}
                key={id}
                onClick={() => setActiveTab(id)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <section
        aria-labelledby={`account-tab-${activeTab}`}
        className="rounded-panel border border-[var(--border-subtle)] bg-surface p-5 shadow-card"
        id={`account-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab === "profile" ? (
          <ProfilePanel
            displayName={displayName || user.displayName || ""}
            onChange={setDisplayName}
            onSave={() => void update.mutateAsync(displayName.trim() || null)}
            saving={update.isPending}
          />
        ) : null}
        {activeTab === "security" ? (
          <SecurityPanel
            passwords={passwords}
            pending={password.isPending}
            onChange={setPasswords}
            onSubmit={() =>
              void password.mutateAsync({
                currentPassword: passwords.currentPassword,
                newPassword: passwords.newPassword,
              })
            }
          />
        ) : null}
        {activeTab === "preferences" ? (
          <PreferencesPanel
            pending={preferences.isPending || updatePreferences.isPending}
            preferences={preferences.data?.preferences ?? {}}
            onSave={(next) => void updatePreferences.mutateAsync(next)}
          />
        ) : null}
        {activeTab === "sessions" ? (
          <SessionsPanel
            items={sessions.data?.items ?? []}
            loading={sessions.isPending}
            revokeOthersPending={revokeOthers.isPending}
            revokePending={revoke.isPending}
            onRevoke={(id) => void revoke.mutateAsync(id)}
            onRevokeOthers={() => void revokeOthers.mutateAsync()}
          />
        ) : null}
        {activeTab === "integrations" ? (
          <IntegrationsPanel
            email={user.email}
            localIdentity={user.discordUsername ?? "Cuenta NodeProx"}
          />
        ) : null}
      </section>
    </div>
  );
}

function ProfilePanel({
  displayName,
  onChange,
  onSave,
  saving,
}: {
  displayName: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="grid max-w-xl gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold">Información personal</h2>
        <p className="mt-1 mb-0 text-sm text-secondary">
          Mantén actualizado el nombre con el que te identificamos en la
          plataforma.
        </p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
        Nombre visible
        <input
          onChange={(event) => onChange(event.target.value)}
          placeholder="Nombre visible"
          value={displayName}
        />
      </label>
      <div className="rounded-control border border-[var(--border-subtle)] bg-surface-elevated p-3">
        <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted">
          Correo electrónico
        </p>
        <p className="mt-1 mb-0 text-sm text-text-secondary">
          El correo se administra a través de una verificación de identidad.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          icon={<Save className="size-4" />}
          loading={saving}
          onClick={onSave}
        >
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

function SecurityPanel({
  passwords,
  pending,
  onChange,
  onSubmit,
}: {
  passwords: {
    currentPassword: string;
    newPassword: string;
    confirmation: string;
  };
  pending: boolean;
  onChange: (value: {
    currentPassword: string;
    newPassword: string;
    confirmation: string;
  }) => void;
  onSubmit: () => void;
}) {
  const mismatch =
    Boolean(passwords.confirmation) &&
    passwords.confirmation !== passwords.newPassword;
  const valid =
    Boolean(passwords.currentPassword) &&
    passwords.newPassword.length >= 8 &&
    !mismatch;
  return (
    <div className="grid max-w-xl gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <div>
          <h2 className="m-0 text-lg font-semibold">Seguridad</h2>
          <p className="mt-1 mb-0 text-sm text-secondary">
            Actualiza tu contraseña y conserva el control de tu cuenta.
          </p>
        </div>
      </div>
      <PasswordField
        label="Contraseña actual"
        value={passwords.currentPassword}
        onChange={(currentPassword) =>
          onChange({ ...passwords, currentPassword })
        }
      />
      <PasswordField
        label="Nueva contraseña"
        value={passwords.newPassword}
        onChange={(newPassword) => onChange({ ...passwords, newPassword })}
      />
      <PasswordField
        label="Confirmar contraseña"
        value={passwords.confirmation}
        onChange={(confirmation) => onChange({ ...passwords, confirmation })}
      />
      {mismatch ? (
        <p className="m-0 text-sm text-danger">Las contraseñas no coinciden.</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={!valid}
          icon={<KeyRound className="size-4" />}
          loading={pending}
          onClick={onSubmit}
        >
          Actualizar contraseña
        </Button>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
      {label}
      <input
        minLength={8}
        onChange={(event) => onChange(event.target.value)}
        type="password"
        value={value}
      />
    </label>
  );
}

function PreferencesPanel({
  preferences,
  pending,
  onSave,
}: {
  preferences: { theme?: "dark" | "system" | "light"; reducedMotion?: boolean };
  pending: boolean;
  onSave: (preferences: {
    theme?: "dark" | "system" | "light";
    reducedMotion?: boolean;
  }) => void;
}) {
  const [theme, setTheme] = useState(preferences.theme ?? "dark");
  const [reducedMotion, setReducedMotion] = useState(
    preferences.reducedMotion ?? false,
  );
  return (
    <div className="grid max-w-xl gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold">Preferencias</h2>
        <p className="mt-1 mb-0 text-sm text-secondary">
          Ajustes guardados para tu cuenta.
        </p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
        Tema
        <select
          onChange={(event) =>
            setTheme(event.target.value as "dark" | "system" | "light")
          }
          value={theme}
        >
          <option value="dark">Oscuro</option>
          <option value="system">Sistema</option>
          <option value="light">Claro</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          checked={reducedMotion}
          onChange={(event) => setReducedMotion(event.target.checked)}
          type="checkbox"
        />
        Reducir movimiento
      </label>
      <div className="flex justify-end">
        <Button
          loading={pending}
          onClick={() => onSave({ theme, reducedMotion })}
        >
          Guardar preferencias
        </Button>
      </div>
    </div>
  );
}

function SessionsPanel({
  items,
  loading,
  revokePending,
  revokeOthersPending,
  onRevoke,
  onRevokeOthers,
}: {
  items: ReadonlyArray<{
    id: string;
    ip: string | null;
    userAgent: string | null;
    current: boolean;
  }>;
  loading: boolean;
  revokePending: boolean;
  revokeOthersPending: boolean;
  onRevoke: (id: string) => void;
  onRevokeOthers: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold">Sesiones activas</h2>
        <p className="mt-1 mb-0 text-sm text-secondary">
          Administra los dispositivos donde tienes una sesión iniciada.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-secondary">Cargando sesiones…</p>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <div
              className="flex min-w-0 items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-elevated p-3"
              key={item.id}
            >
              <Monitor className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-medium">
                  {item.userAgent ?? "Dispositivo desconocido"}
                </p>
                <p className="m-0 text-xs text-secondary">
                  {item.ip ?? "IP oculta"} ·{" "}
                  {item.current ? "Actual" : "Sesión activa"}
                </p>
              </div>
              {item.current ? (
                <StatusBadge label="Actual" tone="success" />
              ) : (
                <Button
                  loading={revokePending}
                  onClick={() => onRevoke(item.id)}
                  size="sm"
                  variant="destructive"
                >
                  Cerrar sesión
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          icon={<Unplug className="size-4" />}
          loading={revokeOthersPending}
          onClick={onRevokeOthers}
          variant="destructive"
        >
          Cerrar todas las demás sesiones
        </Button>
      </div>
    </div>
  );
}

function IntegrationsPanel({
  email,
  localIdentity,
}: {
  email: string;
  localIdentity: string;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="m-0 text-lg font-semibold">Integraciones</h2>
        <p className="mt-1 mb-0 text-sm text-secondary">
          Conecta tu cuenta de NodeProx con otros servicios para mejorar tu
          experiencia.
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <div className="rounded-control border border-[var(--border-subtle)] bg-primary-soft/20 p-4">
          <DiscordLinkSection embedded />
        </div>
        <IntegrationCard
          description="Tu correo está vinculado y se utiliza para notificaciones y recuperación de cuenta."
          icon={<Mail className="size-5" />}
          status="Conectado"
          title="Correo electrónico"
          value={email}
        />
        <IntegrationCard
          description="Autenticación con usuario y contraseña de NodeProx."
          icon={<UserRound className="size-5" />}
          status="Conectado"
          title="Cuenta local"
          value={localIdentity}
        />
      </div>
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  status,
  description,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  description: string;
  value: string;
}) {
  return (
    <article className="grid content-start gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-elevated p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-primary">
          {icon}
        </span>
        <p className="m-0 font-semibold">{title}</p>
        <StatusBadge label={status} tone="success" />
      </div>
      <p className="m-0 min-h-10 text-xs leading-5 text-secondary">
        {description}
      </p>
      <p className="m-0 truncate rounded-control border border-[var(--border-subtle)] bg-surface px-3 py-2 text-sm text-text-secondary">
        {value}
      </p>
    </article>
  );
}

function roleLabel(role: string) {
  return role === "admin"
    ? "Administrador"
    : role === "gestor"
      ? "Gestor"
      : "Uploader";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "short" }).format(
    new Date(value),
  );
}
