import { InternalError } from "@ism0080/forge-core";
import { Effect } from "effect";

export const toInternalError =
  (context: string) =>
  (error: unknown): Effect.Effect<never, InternalError> =>
    Effect.logError(`Unexpected ${context} error`, error).pipe(
      Effect.andThen(Effect.fail(new InternalError({ message: "internal error" }))),
    );
