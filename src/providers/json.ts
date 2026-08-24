import { Schema } from "effect";

import type { JsonValue } from "@/utils.ts";

const JsonNumber = Schema.Number;
const JsonString = Schema.String;
const JsonBoolean = Schema.Boolean;

export const isJsonNumber = (value: JsonValue | undefined): value is number =>
  Schema.is(JsonNumber)(value);

export const isJsonString = (value: JsonValue | undefined): value is string =>
  Schema.is(JsonString)(value);

export const isJsonBoolean = (value: JsonValue | undefined): value is boolean =>
  Schema.is(JsonBoolean)(value);
