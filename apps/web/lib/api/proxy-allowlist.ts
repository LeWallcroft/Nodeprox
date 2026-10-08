export type ProxyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ProxyRouteRule = {
  pattern: string | RegExp;
  methods: readonly ProxyMethod[];
};

const GET = ["GET"] as const;
const POST = ["POST"] as const;
const PUT = ["PUT"] as const;
const PATCH = ["PATCH"] as const;
const DELETE = ["DELETE"] as const;

/** Explicit Web boundary; unknown paths and methods are denied. */
export const PROXY_ROUTE_RULES: readonly ProxyRouteRule[] = [
  { pattern: "health", methods: GET },
  { pattern: "overview", methods: GET },
  {
    pattern:
      /^(auth\/login|auth\/logout|auth\/register|auth\/password-reset\/(request|complete))$/,
    methods: POST,
  },
  { pattern: /^(auth\/session|auth\/capabilities)$/, methods: GET },
  { pattern: "me/discord/link-code", methods: POST },
  { pattern: "me/discord-link", methods: GET },
  { pattern: "me/profile", methods: ["GET", "PATCH"] },
  { pattern: "me/preferences", methods: ["GET", "PATCH"] },
  { pattern: "me/password/change", methods: POST },
  { pattern: "me/sessions", methods: GET },
  { pattern: "me/sessions/revoke-others", methods: POST },
  { pattern: /^me\/sessions\/[^/]+$/, methods: DELETE },
  { pattern: "me/discord/series-channels", methods: GET },
  { pattern: "me/series-creation-grants", methods: GET },
  { pattern: "me/upload-operations", methods: GET },
  {
    pattern:
      /^me\/upload-operations\/(chapter_import|chapter_upload|chapter_replacement)\/[^/]+\/validation-report$/,
    methods: GET,
  },
  {
    pattern:
      /^me\/upload-operations\/(chapter_import|chapter_upload|chapter_replacement)\/[^/]+\/retry$/,
    methods: POST,
  },
  { pattern: "me/notifications", methods: GET },
  { pattern: "me/notifications/unread-count", methods: GET },
  { pattern: /^me\/notifications\/[^/]+\/read$/, methods: PATCH },
  { pattern: "me/notifications/read-all", methods: POST },
  {
    pattern:
      /^(admin\/users|admin\/users\/lookup|admin\/users\/management|admin\/audit|admin\/audit\/export)$/,
    methods: GET,
  },
  { pattern: "admin/settings", methods: ["GET", "PATCH"] },
  { pattern: "admin/storage/profiles", methods: ["GET", "POST"] },
  { pattern: /^admin\/storage\/profiles\/[^/]+$/, methods: ["GET", "PATCH"] },
  { pattern: /^admin\/storage\/profiles\/[^/]+\/readiness$/, methods: GET },
  { pattern: /^admin\/storage\/profiles\/[^/]+\/credentials$/, methods: POST },
  {
    pattern: /^admin\/storage\/profiles\/[^/]+\/b2\/(provision|recheck)$/,
    methods: POST,
  },
  {
    pattern: /^admin\/storage\/profiles\/[^/]+\/cloudflare\/status$/,
    methods: GET,
  },
  {
    pattern:
      /^admin\/storage\/profiles\/[^/]+\/cloudflare\/(provision|recheck)$/,
    methods: POST,
  },
  {
    pattern:
      /^admin\/storage\/profiles\/[^/]+\/browser-probe\/(start|complete)$/,
    methods: POST,
  },
  { pattern: /^admin\/storage\/profiles\/[^/]+\/activate$/, methods: POST },
  { pattern: "admin/discord/authorized-roles", methods: ["GET", "PUT"] },
  { pattern: /^admin\/users\/[^/]+$/, methods: PATCH },
  { pattern: /^admin\/users\/[^/]+\/series-responsibilities$/, methods: PUT },
  { pattern: "admin/series-creation-grants", methods: ["GET", "POST"] },
  {
    pattern: /^admin\/series-creation-grants\/[^/]+\/invalidate$/,
    methods: POST,
  },
  { pattern: /^admin\/series-creation-grants\/[^/]+\/history$/, methods: GET },
  { pattern: "series", methods: ["GET", "POST"] },
  { pattern: /^series\/[^/]+$/, methods: ["GET", "PATCH", "DELETE"] },
  {
    pattern: /^series\/[^/]+\/(capabilities|responsible-candidates)$/,
    methods: GET,
  },
  { pattern: /^series\/[^/]+\/responsible$/, methods: PUT },
  { pattern: /^series\/[^/]+\/uploader$/, methods: ["PUT", "DELETE"] },
  { pattern: /^series\/[^/]+\/chapters$/, methods: ["GET", "POST"] },
  { pattern: /^series\/[^/]+\/import-batches$/, methods: POST },
  {
    pattern: /^series\/[^/]+\/import-batches\/[^/]+\/items\/[^/]+\/retry$/,
    methods: POST,
  },
  { pattern: "chapters", methods: GET },
  { pattern: /^import-batches\/[^/]+$/, methods: GET },
  { pattern: /^chapters\/[^/]+$/, methods: ["GET", "PATCH", "DELETE"] },
  { pattern: /^chapters\/[^/]+\/capabilities$/, methods: GET },
  { pattern: /^chapters\/[^/]+\/permissions$/, methods: ["GET", "POST"] },
  { pattern: /^chapters\/[^/]+\/permissions\/[^/]+$/, methods: DELETE },
  { pattern: /^chapters\/[^/]+\/helper-candidates$/, methods: GET },
  { pattern: /^chapters\/[^/]+\/replacement-session$/, methods: POST },
  {
    pattern: /^chapters\/[^/]+\/replacements\/[^/]+\/complete$/,
    methods: POST,
  },
  { pattern: /^chapters\/[^/]+\/replacements\/[^/]+$/, methods: GET },
  { pattern: /^chapters\/[^/]+\/uploads\/initiate$/, methods: POST },
  {
    pattern: /^chapters\/[^/]+\/uploads\/[^/]+\/(complete|abort)$/,
    methods: POST,
  },
  { pattern: /^chapters\/[^/]+\/images$/, methods: GET },
  {
    pattern: /^chapters\/[^/]+\/images\/[^/]+\/replacement-session$/,
    methods: POST,
  },
  {
    pattern: /^chapters\/[^/]+\/images\/[^/]+\/replacements\/[^/]+\/complete$/,
    methods: POST,
  },
  { pattern: /^images\/[^/]+(\/content)?$/, methods: GET },
  { pattern: /^public\/chapters\/[^/]+$/, methods: GET },
];

export function isAllowedProxyRoute(path: string, method: string): boolean {
  return PROXY_ROUTE_RULES.some(
    (rule) =>
      (typeof rule.pattern === "string"
        ? rule.pattern === path
        : rule.pattern.test(path)) &&
      rule.methods.includes(method as ProxyMethod),
  );
}
