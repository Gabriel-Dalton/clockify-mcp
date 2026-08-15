import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRangeOrder,
  toClockifyInstant,
  toOptionalClockifyInstant,
} from "../build/time.js";

test("UTC timestamps pass through without sub-second noise", () => {
  assert.equal(toClockifyInstant("start", "2026-08-14T09:00:00Z"), "2026-08-14T09:00:00Z");
});

test("offset timestamps are converted to UTC", () => {
  assert.equal(
    toClockifyInstant("start", "2026-08-14T11:00:00+02:00"),
    "2026-08-14T09:00:00Z",
  );
});

test("a bare timestamp is read as local time", () => {
  const local = new Date("2026-08-14T09:00:00");
  assert.equal(
    toClockifyInstant("start", "2026-08-14T09:00:00"),
    local.toISOString().replace(/\.\d{3}Z$/, "Z"),
  );
});

test("an unreadable date names the field and shows the accepted forms", () => {
  assert.throws(
    () => toClockifyInstant("end", "yesterday afternoon"),
    /`end`.*2026-08-14T09:00:00Z/s,
  );
});

test("empty input is rejected rather than becoming the epoch", () => {
  assert.throws(() => toClockifyInstant("start", "   "), /Could not read/);
});

test("optional dates pass undefined through", () => {
  assert.equal(toOptionalClockifyInstant("end", undefined), undefined);
});

test("a backwards range is refused with a usable hint", () => {
  assert.throws(
    () => assertRangeOrder("2026-08-14T17:00:00Z", "2026-08-14T09:00:00Z"),
    /past midnight/,
  );
});

test("a range with no end is allowed, since that is a running timer", () => {
  assert.doesNotThrow(() => assertRangeOrder("2026-08-14T09:00:00Z", undefined));
});
