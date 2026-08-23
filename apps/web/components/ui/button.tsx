import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex min-h-control items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${className}`.trim()}
      {...props}
    />
  );
}
