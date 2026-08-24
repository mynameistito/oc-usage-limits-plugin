import { spawn } from "node:child_process";

import { Context, Effect, Layer } from "effect";

import { ProviderCommandError, ProviderTimeoutError } from "@/errors.ts";
import type { ProviderID } from "@/types.ts";

const COMMAND_OPERATION = "run-command";

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;

/** A bounded provider subprocess request. */
export interface ProviderCommandInput {
  readonly acceptedExitCodes?: ReadonlySet<number>;
  readonly args: readonly string[];
  readonly command: string;
  readonly providerID: ProviderID;
  readonly timeoutMs: number;
}

/** Interruptible, output-capped provider subprocess execution. */
export class ProviderCommandExecutor extends Context.Service<
  ProviderCommandExecutor,
  {
    readonly execute: (
      input: ProviderCommandInput
    ) => Effect.Effect<string, ProviderCommandError | ProviderTimeoutError>;
  }
>()("oc-usage-limits/ProviderCommandExecutor") {}

const execute = (
  input: ProviderCommandInput
): Effect.Effect<string, ProviderCommandError | ProviderTimeoutError> => {
  const operation = Effect.callback<string, ProviderCommandError>((resume) => {
    const child = spawn(input.command, input.args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (cause: "command" | "output-limit", exitCode?: number) => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resume(
        Effect.fail(
          new ProviderCommandError({
            cause,
            exitCode,
            operation: COMMAND_OPERATION,
            providerID: input.providerID,
          })
        )
      );
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_COMMAND_OUTPUT_BYTES) {
        fail("output-limit");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES) {
        fail("output-limit");
      }
    });
    child.once("error", () => fail("command"));
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      const exitCode = code ?? -1;
      const accepted =
        exitCode === 0 || input.acceptedExitCodes?.has(exitCode) === true;
      resume(
        accepted
          ? Effect.succeed(Buffer.concat(stdout).toString("utf-8").trim())
          : Effect.fail(
              new ProviderCommandError({
                cause: "command",
                exitCode,
                operation: COMMAND_OPERATION,
                providerID: input.providerID,
              })
            )
      );
    });

    return Effect.sync(() => {
      settled = true;
      child.kill();
    });
  });

  return operation.pipe(
    Effect.timeoutOrElse({
      duration: input.timeoutMs,
      orElse: () =>
        Effect.fail(
          new ProviderTimeoutError({
            cause: "timeout",
            operation: COMMAND_OPERATION,
            providerID: input.providerID,
            timeoutMs: input.timeoutMs,
          })
        ),
    })
  );
};

/** Live bounded subprocess layer. */
export const ProviderCommandExecutorLive = Layer.succeed(
  ProviderCommandExecutor,
  { execute }
);
