import { Effect, Schema } from "effect";

export class CronError extends Schema.TaggedError<CronError>()("CronError", {
  expression: Schema.String,
  message: Schema.String,
}) {}

export interface CronSchedule {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

interface FieldBounds {
  readonly min: number;
  readonly max: number;
  readonly normalizeSunday: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_LOOKAHEAD_DAYS = 366 * 5;

const invalid = (expression: string, message: string): CronError =>
  new CronError({ expression, message });

const normalizeValue = (value: number, bounds: FieldBounds): number =>
  bounds.normalizeSunday && value === 7 ? 0 : value;

const parseStep = (
  raw: string,
  expression: string,
  field: string,
): Effect.Effect<{ readonly range: string; readonly step: number }, CronError> => {
  const slash = raw.indexOf("/");
  if (slash === -1) {
    return Effect.succeed({ range: raw, step: 1 });
  }
  const range = raw.slice(0, slash);
  const stepText = raw.slice(slash + 1);
  if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
    return Effect.fail(invalid(expression, `invalid ${field} step "${stepText}"`));
  }
  return Effect.succeed({ range, step: Number(stepText) });
};

const collect = (
  from: number,
  to: number,
  step: number,
  bounds: FieldBounds,
  into: Set<number>,
): void => {
  for (let value = from; value <= to; value += step) {
    into.add(normalizeValue(value, bounds));
  }
};

const expandRange = (
  lowText: string,
  highText: string,
  step: number,
  bounds: FieldBounds,
  expression: string,
  field: string,
): Effect.Effect<ReadonlyArray<number>, CronError> => {
  const low = Number(lowText);
  const high = Number(highText);
  if (!/^\d+$/.test(lowText) || !/^\d+$/.test(highText)) {
    return Effect.fail(invalid(expression, `invalid ${field} range "${lowText}-${highText}"`));
  }
  if (low < bounds.min || high > bounds.max || low > high) {
    return Effect.fail(
      invalid(expression, `${field} range "${lowText}-${highText}" is out of bounds`),
    );
  }
  const values = new Set<number>();
  collect(low, high, step, bounds, values);
  return Effect.succeed([...values]);
};

const expandSegment = (
  segment: string,
  bounds: FieldBounds,
  expression: string,
  field: string,
): Effect.Effect<ReadonlyArray<number>, CronError> =>
  Effect.gen(function* () {
    const { range, step } = yield* parseStep(segment, expression, field);
    if (range === "*") {
      const values = new Set<number>();
      collect(bounds.min, bounds.max, step, bounds, values);
      return [...values];
    }
    if (range.includes("-")) {
      const [lowText = "", highText = ""] = range.split("-");
      return yield* expandRange(lowText, highText, step, bounds, expression, field);
    }
    if (!/^\d+$/.test(range)) {
      return yield* invalid(expression, `invalid ${field} value "${range}"`);
    }
    const value = Number(range);
    if (value < bounds.min || value > bounds.max) {
      return yield* invalid(expression, `${field} value "${range}" is out of bounds`);
    }
    const values = new Set<number>();
    collect(value, step === 1 ? value : bounds.max, step, bounds, values);
    return [...values];
  });

const expandField = (
  raw: string,
  bounds: FieldBounds,
  expression: string,
  field: string,
): Effect.Effect<ReadonlySet<number>, CronError> =>
  Effect.gen(function* () {
    const values = new Set<number>();
    const segments = raw.split(",");
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.length === 0) {
        return yield* invalid(expression, `empty ${field} segment in "${raw}"`);
      }
      const expanded = yield* expandSegment(trimmed, bounds, expression, field);
      for (const value of expanded) {
        values.add(value);
      }
    }
    return values;
  });

const expandMinutes = (raw: string, expression: string) =>
  expandField(raw, { min: 0, max: 59, normalizeSunday: false }, expression, "minute");

const expandHours = (raw: string, expression: string) =>
  expandField(raw, { min: 0, max: 23, normalizeSunday: false }, expression, "hour");

const expandDaysOfMonth = (raw: string, expression: string) =>
  expandField(raw, { min: 1, max: 31, normalizeSunday: false }, expression, "day of month");

const expandMonths = (raw: string, expression: string) =>
  expandField(raw, { min: 1, max: 12, normalizeSunday: false }, expression, "month");

const expandDaysOfWeek = (raw: string, expression: string) =>
  expandField(raw, { min: 0, max: 7, normalizeSunday: true }, expression, "day of week");

export const parseCron = (expression: string): Effect.Effect<CronSchedule, CronError> =>
  Effect.gen(function* () {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return yield* invalid(
        expression,
        "expected exactly 5 fields (minute hour day month weekday)",
      );
    }
    const [minuteRaw = "", hourRaw = "", dayRaw = "", monthRaw = "", weekdayRaw = ""] = parts;
    const minutes = yield* expandMinutes(minuteRaw, expression);
    const hours = yield* expandHours(hourRaw, expression);
    const daysOfMonth = yield* expandDaysOfMonth(dayRaw, expression);
    const months = yield* expandMonths(monthRaw, expression);
    const daysOfWeek = yield* expandDaysOfWeek(weekdayRaw, expression);
    return {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      dayOfMonthRestricted: !dayRaw.startsWith("*"),
      dayOfWeekRestricted: !weekdayRaw.startsWith("*"),
    };
  });

const sorted = (values: ReadonlySet<number>): ReadonlyArray<number> =>
  [...values].sort((left, right) => left - right);

const dayMatches = (schedule: CronSchedule, date: Date): boolean => {
  const dayOfMonthMatch = schedule.daysOfMonth.has(date.getUTCDate());
  const dayOfWeekMatch = schedule.daysOfWeek.has(date.getUTCDay());
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return dayOfMonthMatch || dayOfWeekMatch;
  }
  if (schedule.dayOfMonthRestricted) {
    return dayOfMonthMatch;
  }
  if (schedule.dayOfWeekRestricted) {
    return dayOfWeekMatch;
  }
  return true;
};

export const nextCronRun = (schedule: CronSchedule, fromMs: number): number | undefined => {
  const minutes = sorted(schedule.minutes);
  const hours = sorted(schedule.hours);
  if (minutes.length === 0 || hours.length === 0) {
    return undefined;
  }
  const start = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const startDate = new Date(start);
  const firstDay = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const lastDay = firstDay + MAX_LOOKAHEAD_DAYS * DAY_MS;
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const date = new Date(day);
    if (!schedule.months.has(date.getUTCMonth() + 1)) {
      continue;
    }
    if (!dayMatches(schedule, date)) {
      continue;
    }
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = day + hour * HOUR_MS + minute * MINUTE_MS;
        if (candidate >= start) {
          return candidate;
        }
      }
    }
  }
  return undefined;
};

export const nextCronRunFromExpression = (
  expression: string,
  fromMs: number,
): Effect.Effect<number, CronError> =>
  Effect.gen(function* () {
    const schedule = yield* parseCron(expression);
    const next = nextCronRun(schedule, fromMs);
    if (next === undefined) {
      return yield* invalid(expression, "schedule does not match any time within five years");
    }
    return next;
  });
