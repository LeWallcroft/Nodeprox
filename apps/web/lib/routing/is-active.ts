export function isNavigationItemActive(
  pathname: string,
  href?: string,
): boolean {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  // Administrative siblings are independent destinations. A parent /admin
  // link must not shadow a more specific child such as /admin/users.
  if (href === "/admin" || href.startsWith("/admin/")) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
