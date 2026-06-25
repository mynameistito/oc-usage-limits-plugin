/**
 * Determines whether a hostname refers to the local machine.
 *
 * Loopback hosts are the only case where plain `http` is permitted, so local
 * test servers do not require a TLS certificate.
 *
 * @param hostname - Hostname from a parsed URL (no port; IPv6 literals keep
 *   their surrounding brackets per the WHATWG URL standard).
 * @returns `true` when the host is a loopback address.
 */
const isLoopbackHost = (hostname: string): boolean => {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return (
    host === "localhost" ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  );
};

/**
 * Resolves and validates an HTTPS API base URL before it reaches a request.
 *
 * Only `https` URLs are allowed; `http` is permitted solely for loopback hosts.
 * Anything that fails to parse, or uses another scheme, falls back to the
 * default so credentials are never sent to an unexpected host.
 *
 * @param baseUrl - Configured base URL, or `undefined` for the default.
 * @param defaultUrl - Safe fallback when the configured value is invalid.
 * @returns A safe, absolute URL string with no trailing slash.
 */
export const resolveHttpsBaseUrl = (
  baseUrl: string | undefined,
  defaultUrl: string
): string => {
  const fallback = defaultUrl.replace(/\/$/u, "");
  let parsed: URL;
  try {
    parsed = new URL((baseUrl ?? defaultUrl).trim());
  } catch {
    return fallback;
  }

  const allowed =
    parsed.protocol === "https:" ||
    (isLoopbackHost(parsed.hostname) && parsed.protocol === "http:");
  return allowed ? parsed.toString().replace(/\/$/u, "") : fallback;
};
