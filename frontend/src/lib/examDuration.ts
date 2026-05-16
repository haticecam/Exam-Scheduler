// MUST stay in sync with core/services/exam_duration.py.
// If the rule changes there, change it here too (and run the Python tests).

export type DurationInputs = {
  weekly_hours_lecture: number | null | undefined;
  exam_duration_minutes: number | null | undefined;
};

export function courseExamDurationMinutes(
  c: DurationInputs,
  slotDurationMinutes: number,
  sessionMode: boolean,
): number {
  if (sessionMode) return slotDurationMinutes;
  if (c.exam_duration_minutes) {
    return Math.ceil(c.exam_duration_minutes / 30) * 30;
  }
  const hours = c.weekly_hours_lecture ?? 0;
  if (hours >= 4) return 180;
  if (hours === 3) return 120;
  return 60;
}

export function groupExamDurationMinutes(
  courses: DurationInputs[],
  slotDurationMinutes: number,
  sessionMode: boolean,
): number {
  if (courses.length === 0) return 0;
  return Math.max(
    ...courses.map((c) => courseExamDurationMinutes(c, slotDurationMinutes, sessionMode)),
  );
}

export function intervalsOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean {
  // Half-open [start, end): adjacent (==) does not overlap.
  return aStart < bEnd && bStart < aEnd;
}

export function timeStringToMinutes(t: string): number {
  // Accepts "HH:MM" or "HH:MM:SS".
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
