import { expect, test } from "bun:test";
import { InternalError, NotFoundError } from "surrealdb";
import { isIdentityAuthRefusal } from "../src/provider/auth-error.ts";

test("empty SIGNIN is refused on both supported server error shapes", () => {
  expect(isIdentityAuthRefusal(new InternalError({ kind: "Internal", message: "No record was returned" }))).toBe(true);
  expect(isIdentityAuthRefusal(new NotFoundError({ kind: "NotFound", message: "No record was returned" }))).toBe(true);
});

test("missing resources and arbitrary errors are not mislabeled as wrong passwords", () => {
  expect(isIdentityAuthRefusal(new Error("No record was returned"))).toBe(false);
  expect(isIdentityAuthRefusal(new InternalError({ kind: "Internal", message: "Other failure" }))).toBe(false);
  for (const kind of ["Database", "Namespace", "Table"]) {
    expect(isIdentityAuthRefusal(new NotFoundError({ kind: "NotFound", message: "No record was returned", details: { kind, details: { name: "missing" } } }))).toBe(false);
  }
  expect(isIdentityAuthRefusal(new NotFoundError({ kind: "NotFound", message: "Missing access method" }))).toBe(false);
});
