import { Config, Duration, Effect, Layer } from "effect";
import { DbClockService } from "../db/shared.js";
import { JobsService } from "./service.js";

export const JobRunnerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const enabled = yield* Config.boolean("JOB_RUNNER_ENABLED").pipe(Config.withDefault(true));
    if (!enabled) {
      return;
    }
    const intervalMs = yield* Config.number("JOB_RUNNER_INTERVAL_MS").pipe(
      Config.withDefault(30_000),
    );
    const jobs = yield* JobsService;
    const clock = yield* DbClockService;

    const loop = Effect.gen(function* () {
      const now = yield* clock.currentTimeMs;
      const processed = yield* jobs.runDue(now).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("job runner failed", cause).pipe(Effect.as(0)),
        ),
      );
      if (processed > 0) {
        yield* Effect.log(`job runner processed ${processed} job(s)`);
      }
      yield* Effect.sleep(Duration.millis(Math.max(1_000, intervalMs)));
    });

    yield* Effect.forkScoped(Effect.forever(loop));
  }),
);
