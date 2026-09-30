/**
 * Pins the test timezone to Asia/Manila.
 *
 * Without this, the date tests are only meaningful on a machine east of UTC.
 * The bug they guard against — `toISOString().slice(0, 10)` returning the
 * PREVIOUS calendar day — does not occur at UTC+0 at all, so the naive
 * implementation would pass every one of them on a CI runner in UTC while
 * still corrupting `date_of_completion` in production in Manila.
 *
 * Node re-reads process.env.TZ at runtime, so setting it here, before any test
 * module constructs a Date, makes the suite assert the same thing everywhere:
 * on a laptop in Manila, on a GitHub runner in UTC, and on anyone else's
 * machine in any zone.
 *
 * This is deliberately the deployment timezone rather than the developer's.
 * The system runs for PPDO Iloilo Province; Manila time is the environment the
 * correctness claim is about.
 */
process.env.TZ = "Asia/Manila";
