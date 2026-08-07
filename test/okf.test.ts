import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeOkf } from "../src/store/okf.ts";
import type { Manifest } from "../src/projection/resolve.ts";

const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function divergentCheckout(dirty = false, unrelated = false): { root: string; checkout: string } {
  const root = mkdtempSync(join(tmpdir(), "merovingian-okf-"));
  temporaryRoots.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const checkout = join(root, "checkout");
  const other = join(root, "other");

  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "main", seed);
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.com");
  writeFileSync(join(seed, "README.md"), "base\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "-m", "base");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-u", "origin", "main");

  git(root, "clone", "--branch", "main", remote, checkout);
  git(checkout, "config", "user.name", "Test");
  git(checkout, "config", "user.email", "test@example.com");
  git(root, "clone", "--branch", "main", remote, other);
  git(other, "config", "user.name", "Test");
  git(other, "config", "user.email", "test@example.com");
  writeFileSync(join(other, "README.md"), "remote\n");
  git(other, "add", "README.md");
  git(other, "commit", "-m", "remote change");
  git(other, "push", "origin", "main");

  writeFileSync(join(checkout, "README.md"), "local\n");
  git(checkout, "add", "README.md");
  git(checkout, "commit", "-m", "local change");
  if (dirty) writeFileSync(join(checkout, "uncommitted.txt"), "keep me\n");

  if (unrelated) {
    const replacement = join(root, "replacement");
    git(root, "init", "-b", "main", replacement);
    git(replacement, "config", "user.name", "Test");
    git(replacement, "config", "user.email", "test@example.com");
    writeFileSync(join(replacement, "README.md"), "unrelated\n");
    git(replacement, "add", "README.md");
    git(replacement, "commit", "-m", "unrelated history");
    git(replacement, "remote", "add", "origin", remote);
    git(replacement, "push", "--force", "origin", "main");
  }

  return { root, checkout };
}

function manifestFor(checkout: string): Manifest {
  return {
    okf: [{ bucket: "events", repo: "example/events", path: checkout, writable: true }],
  } as Manifest;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("okf materialization", () => {
  test("mounts a clean divergent checkout as stale instead of denying the workspace", async () => {
    const { root, checkout } = divergentCheckout();
    const result = await materializeOkf(manifestFor(checkout), join(root, "workspace"));

    expect(result.denied).toEqual([]);
    expect(result.mounted).toEqual([{ bucket: "events", path: checkout }]);
    expect(result.stale).toHaveLength(1);
    expect(readlinkSync(join(root, "workspace", "context", "events"))).toBe(checkout);
  });

  test("keeps a dirty divergent checkout unmounted", async () => {
    const { root, checkout } = divergentCheckout(true);
    const result = await materializeOkf(manifestFor(checkout), join(root, "workspace"));

    expect(result.mounted).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.denied).toHaveLength(1);
    expect(() => lstatSync(join(root, "workspace", "context", "events"))).toThrow();
  });

  test("keeps an unrelated history unmounted", async () => {
    const { root, checkout } = divergentCheckout(false, true);
    const result = await materializeOkf(manifestFor(checkout), join(root, "workspace"));

    expect(result.mounted).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.denied).toHaveLength(1);
    expect(() => lstatSync(join(root, "workspace", "context", "events"))).toThrow();
  });
});
