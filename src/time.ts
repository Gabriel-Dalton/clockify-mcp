/**
 * Date handling for tool inputs.
 *
 * Models pass dates in whatever shape the conversation used, so the rule here
 * is: accept the reasonable forms, convert to the UTC instant Clockify wants,
 * and fail with a message that says what was wrong rather than
 * "Invalid time value".
 */

export class InvalidDateError extends Error {
  constructor(field: string, value: string) {
    super(
      `Could not read "${value}" as a date for \`${field}\`. Use either ` +
        `2026-08-14T09:00:00 (local time) or 2026-08-14T09:00:00Z (UTC).`,
    );
    this.name = "InvalidDateError";
  }
}

/**
 * Converts a tool-supplied date to the `yyyy-MM-ddTHH:mm:ssZ` instant Clockify
 * expects. Bare timestamps with no zone are read as local time, which is what
 * a user means by "9am".
 */
export function toClockifyInstant(field: string, value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new InvalidDateError(field, value);

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new InvalidDateError(field, value);

  // Clockify rejects sub-second precision on some endpoints.
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Same conversion, but passes `undefined` through for optional fields. */
export function toOptionalClockifyInstant(
  field: string,
  value: string | undefined,
): string | undefined {
  return value === undefined ? undefined : toClockifyInstant(field, value);
}

/**
 * Rejects a backwards range up front. Clockify accepts it and stores an entry
 * with a negative duration, which then reads as a data-entry mystery later.
 */
export function assertRangeOrder(start: string, end?: string): void {
  if (!end) return;
  if (new Date(end).getTime() < new Date(start).getTime()) {
    throw new Error(
      `The end time (${end}) is before the start time (${start}). ` +
        "If the work ran past midnight, include the next day's date in `end`.",
    );
  }
}
