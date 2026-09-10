import { InternalError } from "@ism0080/forge-core";
import { Effect } from "effect";

export const toInternalError =
  (context: string) =>
  (cause: unknown): Effect.Effect<never, InternalError> =>
    Effect.logError(`Unexpected ${context} error`, cause).pipe(
      Effect.andThen(Effect.fail(new InternalError({ message: "internal error" }))),
    );
