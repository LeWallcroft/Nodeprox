import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NodeProx",
  description: "NodeProx technical bootstrap",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
