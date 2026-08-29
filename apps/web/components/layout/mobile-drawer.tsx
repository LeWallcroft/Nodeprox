import type { ReactNode } from "react";

export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {open ? (
        <button
          className="fixed inset-0 z-20 border-0 bg-black/55 md:hidden"
          type="button"
          aria-label="Cerrar navegación"
          onClick={onClose}
        />
      ) : null}
      {children}
    </>
  );
}
