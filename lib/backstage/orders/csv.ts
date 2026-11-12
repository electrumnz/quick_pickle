/**
 * Writing and reading the plain files that go between the back end and
 * somebody else's website: a courier's, an accountant's spreadsheet.
 *
 * This file imports nothing.
 */

/**
 * A spreadsheet runs a cell that starts with one of these as a sum, and a
 * sum can fetch from the web or start a program. Every cell in these files
 * that a customer typed (a name, an address, a note for the courier) could
 * start with one, so such a cell is made plain text with a leading
 * apostrophe, which a spreadsheet does not show.
 *
 * A phone number is the one honest thing that starts with a plus, and a
 * courier needs it as typed. Digits, spaces, brackets and dashes cannot do
 * any harm, so a cell made only of those is left alone.
 */
const STARTS_A_SUM = /^[=+\-@\t\r]/;
const ONLY_A_NUMBER = /^[+\-]?[\d\s().-]*$/;

export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe =
    STARTS_A_SUM.test(raw) && !ONLY_A_NUMBER.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Rows as one file. Lines end the way the format says they should (CRLF),
 * and the file opens with the mark that tells a spreadsheet it is UTF-8, so
 * a macron in a name arrives as a macron.
 */
export function toCsv(
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `﻿${body}\r\n`;
}

/**
 * One line of a file as its cells. Handles a cell in quotes with commas and
 * doubled quotes inside it. A file with a line break inside a cell is read
 * line by line all the same, which splits that cell: good enough for the
 * files read here, where the cells that matter never hold one.
 */
export function csvLine(line: string, separator = ","): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];
    if (quoted) {
      if (char === '"' && line[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Cents as a plain figure for a spreadsheet: 4800 is "48.00". */
export function centsAsFigure(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.abs(cents);
  return `${sign}${String(Math.trunc(whole / 100))}.${String(whole % 100).padStart(2, "0")}`;
}
