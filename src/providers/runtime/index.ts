import { Layer } from "effect";

import type { ProviderClock } from "@/providers/runtime/clock.ts";
import { ProviderClockLive } from "@/providers/runtime/clock.ts";
import type { ProviderCommandExecutor } from "@/providers/runtime/command.ts";
import { ProviderCommandExecutorLive } from "@/providers/runtime/command.ts";
import type { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderEnvironmentLive } from "@/providers/runtime/environment.ts";
import type { ProviderFileSystem } from "@/providers/runtime/filesystem.ts";
import { ProviderFileSystemLive } from "@/providers/runtime/filesystem.ts";
import type { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderHttpClientLive } from "@/providers/runtime/http.ts";

/** Runtime services required by every provider definition. */
export type ProviderRuntime =
  | ProviderClock
  | ProviderCommandExecutor
  | ProviderEnvironment
  | ProviderFileSystem
  | ProviderHttpClient;

/** Production provider runtime layer. */
export const ProviderRuntimeLive = Layer.mergeAll(
  ProviderClockLive,
  ProviderCommandExecutorLive,
  ProviderEnvironmentLive,
  ProviderFileSystemLive,
  ProviderHttpClientLive
);
