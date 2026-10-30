import type { InspectionReport } from "./inspect.js"

export const INPUT_ERRORS = {
  file_not_found: "File not found; check the path and current directory",
  permission_denied: "File is not readable; check its permissions",
  not_regular_file: "Expected a regular file; use '-' for standard input",
  input_too_large: "File exceeds the 8 MiB inspection limit",
  invalid_encoding: "Expected UTF-8 XML; re-export the file as FDX",
  read_failed: "Could not read file",
} as const
export type InputErrorCode = keyof typeof INPUT_ERRORS
export type InputResult =
  | { input: string; report: InspectionReport }
  | { input: string; error: { code: InputErrorCode; message: string } }
export interface InspectionBatch {
  schemaVersion: 1
  results: InputResult[]
}
