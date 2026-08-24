import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Normalizes an arbitrary number into the inclusive percentage range used by UI.
 *
 * @param value - Provider-reported percentage value.
 * @returns A finite number clamped between `0` and `100`.
 */
export const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Checks whether a value is a plain object-like record.
 *
 * This intentionally excludes arrays because provider API payloads are parsed as
 * `unknown` and object fields are accessed only after this guard succeeds.
 *
 * @param value - Value to narrow.
 * @returns `true` when the value can be safely indexed as a record.
 */
export interface UnknownRecord {
  readonly [key: string]: JsonValue;
}
export type JsonValue =
  | UnknownRecord
  | readonly JsonValue[]
  | string
  | number
  | boolean
  | null;

export const isRecord = <T>(value: T): value is T & UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripTrailingCommas = (input: string): string => {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    let keep = true;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    } else if (char === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(input[lookahead] ?? "")) {
        lookahead += 1;
      }
      if (input[lookahead] === "}" || input[lookahead] === "]") {
        keep = false;
      }
    }
    if (keep) {
      output += char;
    }
  }

  return output;
};

/**
 * Removes JSONC comments and trailing commas while preserving string contents.
 *
 * The plugin accepts small user-authored config files without adding a JSONC
 * dependency. Both line comments and block comments are stripped, but comment
 * markers inside quoted strings are left untouched.
 *
 * @param input - Raw JSONC text.
 * @returns JSON-compatible text suitable for `JSON.parse`.
 */
interface ConsumedString {
  readonly text: string;
  readonly end: number;
}

const consumeString = (input: string, start: number): ConsumedString => {
  let index = start;
  let escaped = false;
  const quote = input[index] ?? "";
  let text = quote;
  index += 1;
  while (index < input.length) {
    const char = input[index] ?? "";
    text += char;
    index += 1;
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      break;
    }
  }
  return { end: index, text };
};

const stripJsonComments = (input: string): string => {
  let output = "";
  let remaining = input;
  while (remaining.length > 0) {
    const [char, next] = remaining;
    if (char === '"' || char === "'") {
      const string = consumeString(remaining, 0);
      output += string.text;
      remaining = remaining.slice(string.end);
    } else if (char === "/" && next === "/") {
      const newline = remaining.indexOf("\n");
      if (newline === -1) {
        break;
      }
      output += "\n";
      remaining = remaining.slice(newline);
    } else if (char === "/" && next === "*") {
      const end = remaining.indexOf("*/", 2);
      if (end === -1) {
        throw new SyntaxError("Unterminated JSONC block comment");
      }
      remaining = remaining.slice(end + 2);
    } else {
      output += char;
      remaining = remaining.slice(1);
    }
  }

  return stripTrailingCommas(output);
};

/**
 * Expands a leading home-directory marker in a filesystem path.
 *
 * @param value - Path that may start with `~`, `~/`, or `~\`.
 * @returns The path with a leading home marker replaced by the user's home path.
 */
const expandHome = (value: string): string =>
  value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(homedir(), value.slice(2))
    : value;

/**
 * Reads and parses a JSON or JSONC file.
 *
 * A leading `~` in the path is expanded before reading. The parsed value remains
 * `unknown` so its owning boundary must decode it before use.
 *
 * @param filePath - Absolute path, relative path, or home-relative path to read.
 * @returns The parsed JSON value as `unknown`.
 */
export const readJsonFile = async (filePath: string): Promise<JsonValue> => {
  const raw = await readFile(expandHome(filePath), "utf-8");
  const parsed: unknown = JSON.parse(stripJsonComments(raw));
  // SAFETY: JSON.parse returns the JSON value represented by the file.
  return parsed as JsonValue;
};

/**
 * Resolves a config value that may reference an environment variable.
 *
 * Values in the form `{env:NAME}` are replaced with `process.env.NAME`. Any
 * other non-empty string is returned unchanged.
 *
 * @param value - Raw config value or environment reference.
 * @returns The resolved value, unchanged literal, or `undefined` when absent.
 */
export const resolveEnvReference = (
  value: string | undefined
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const envMatch = /^\{env:(?<name>[^}]+)\}$/iu.exec(value.trim());
  if (envMatch?.groups?.name) {
    return process.env[envMatch.groups.name];
  }

  return value;
};

/**
 * Fetches a JSON endpoint with a timeout and normalized provider-facing errors.
 *
 * HTTP status codes that commonly matter for auth and quota diagnostics are
 * mapped to stable messages, while successful non-JSON responses are rejected as
 * invalid provider payloads.
 *
 * @param url - Endpoint URL to request.
 * @param init - Fetch options such as method and headers.
 * @param timeoutMs - Timeout in milliseconds when `init.signal` is not supplied.
 * @returns The parsed JSON payload as `unknown` for caller-side validation.
 * @throws {Error} When the response is unsuccessful or cannot be parsed as JSON.
 */
export const fetchJson = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<JsonValue> => {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("unauthorized");
    }
    if (response.status === 403) {
      throw new Error("forbidden");
    }
    if (response.status === 429) {
      throw new Error("rate limited");
    }
    throw new Error(`HTTP ${response.status}`);
  }

  try {
    const parsed: unknown = JSON.parse(body);
    // SAFETY: The response body was successfully decoded as JSON.
    return parsed as JsonValue;
  } catch {
    throw new Error("invalid JSON");
  }
};
