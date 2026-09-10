import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Result from "effect/Result";
import { nextCronRunFromExpression, parseCron } from "../src/services/jobs/cron.js";

const FIXED = Date.UTC(2030, 0, 1, 0, 0, 0);

const nextOf = (expression: string, fromMs: number): number => {
  const result = Effect.runSync(Effect.result(nextCronRunFromExpression(expression, fromMs)));
  if (Result.isFailure(result)) {
    throw result.failure;
  }
  return result.success;
};

describe("cron", () => {
  it("parses wildcard expressions", () => {
    const schedule = Effect.runSync(parseCron("* * * * *"));
    expect(schedule.minutes.size).toBe(60);
    expect(schedule.hours.size).toBe(24);
    expect(schedule.dayOfMonthRestricted).toBe(false);
    expect(schedule.dayOfWeekRestricted).toBe(false);
  });

  it("computes the next minute for every-minute schedules", () => {
    const next = nextOf("* * * * *", Date.UTC(2030, 0, 1, 0, 0, 30));
    expect(new Date(next).toISOString()).toBe("2030-01-01T00:01:00.000Z");
  });

  it("computes the next daily run", () => {
    const next = nextOf("0 3 * * *", FIXED);
    expect(new Date(next).toISOString()).toBe("2030-01-01T03:00:00.000Z");
  });

  it("supports steps, ranges, and lists", () => {
    const schedule = Effect.runSync(parseCron("*/15 9-10 * * 1,3,5"));
    expect([...schedule.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect([...schedule.hours].sort((a, b) => a - b)).toEqual([9, 10]);
    expect([...schedule.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });

  it("normalizes sunday as both 0 and 7", () => {
    const schedule = Effect.runSync(parseCron("0 0 * * 7"));
    expect([...schedule.daysOfWeek]).toEqual([0]);
  });

  it("treats restricted day-of-month and day-of-week as an OR", () => {
    const next = nextOf("0 0 1 * 1", Date.UTC(2030, 0, 2, 0, 0, 0));
    expect(new Date(next).toISOString()).toBe("2030-01-07T00:00:00.000Z");
  });

  it("treats a step day-of-month as unrestricted for the OR rule", () => {
    const next = nextOf("0 0 */2 * 1", Date.UTC(2030, 0, 2, 0, 0, 0));
    expect(new Date(next).toISOString()).toBe("2030-01-07T00:00:00.000Z");
  });

  it("rejects malformed expressions", () => {
    expect(Result.isFailure(Effect.runSync(Effect.result(parseCron("0 0 0"))))).toBe(true);
    expect(Result.isFailure(Effect.runSync(Effect.result(parseCron("60 * * * *"))))).toBe(true);
    expect(Result.isFailure(Effect.runSync(Effect.result(parseCron("nope"))))).toBe(true);
  });
});
