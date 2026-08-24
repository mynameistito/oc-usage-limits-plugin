import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Schema } from "effect";

/** JSON object returned by provider and configuration boundaries. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON arrays returned by provider and configuration boundaries. */
type JsonArray = JsonValue[];

/** JSON values returned by provider and configuration boundaries. */
export type JsonValue =
  | boolean
  | JsonArray
  | JsonObject
  | null
  | number
  | string
  | undefined;

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
export const isRecord = <T>(value: T): value is T & JsonObject =>
  value !== null &&
  !Array.isArray(value) &&
  Object.prototype.toString.call(value) === "[object Object]";

export const isString = <T>(value: T): value is T & string =>
  Schema.is(Schema.String)(value);

const isTrailingComma = (input: string, index: number): boolean => {
  let lookahead = index + 1;
  while (/\s/u.test(input[lookahead] ?? "")) {
    lookahead += 1;
  }
  return input[lookahead] === "}" || input[lookahead] === "]";
};

const stripTrailingCommas = (input: string): string => {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  let index = 0;
  while (index < input.length) {
    const char = input[index];

    if (inString) {
      output += char;
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
      output += char;
    } else if (char === "," && isTrailingComma(input, index)) {
      index += 1;
      continue;
    } else {
      output += char;
    }
    index += 1;
  }

  return output;
};

const skipLineComment = (input: string, start: number): number => {
  let index = start;
  while (index < input.length && input[index] !== "\n") {
    index += 1;
  }
  return index;
};

const skipBlockComment = (input: string, start: number): number => {
  let index = start + 2;
  while (
    index < input.length &&
    !(input[index] === "*" && input[index + 1] === "/")
  ) {
    index += 1;
  }
  if (index >= input.length) {
    throw new SyntaxError("Unterminated JSONC block comment");
  }
  return index + 2;
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
const stripJsonComments = (input: string): string => {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  let index = 0;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (inString) {
      output += char;
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
      output += char;
    } else if (char === "/" && next === "/") {
      index = skipLineComment(input, index);
      output += "\n";
    } else if (char === "/" && next === "*") {
      index = skipBlockComment(input, index) - 1;
    } else {
      output += char;
    }
    index += 1;
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
  // SAFETY: JSON.parse returns only values represented by the JSON boundary type.
  const parsed = JSON.parse(stripJsonComments(raw)) as JsonValue;
  return parsed;
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
    // SAFETY: JSON.parse returns only values represented by the JSON boundary type.
    const parsed = JSON.parse(body) as JsonValue;
    return parsed;
  } catch {
    throw new Error("invalid JSON");
  }
};
