import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { contentDir } from "../paths.ts";

const identity = {
  GIT_AUTHOR_NAME: "Advocat Redaktion",
  GIT_AUTHOR_EMAIL: "redaktion@advocat.local",
  GIT_COMMITTER_NAME: "Advocat Redaktion",
  GIT_COMMITTER_EMAIL: "redaktion@advocat.local",
};

function git(): SimpleGit {
  // Nur PATH und die Redaktions-Identität. Die Umgebung des Prozesses
  // enthält Editor-Variablen, die simple-git als unsicher ablehnt.
  return simpleGit({
    baseDir: contentDir(),
    config: ["safe.directory=*"],
  }).env({
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...identity,
  });
}

export async function ensureContentGit(): Promise<void> {
  const repo = git();
  if (!(await repo.checkIsRepo())) await repo.init();
}

export interface Revision {
  rev: string;
  date: string;
  message: string;
  /** Wie die Datei in dieser Fassung hiess. Ein Newsletter bekommt beim Veröffentlichen einen neuen Namen. */
  path: string;
}

/** Commitet nur die genannten Pfade. Eine handgeänderte andere Datei bleibt aussen vor. */
export async function commitIfChanged(message: string, files: string[]): Promise<string | null> {
  if (files.length === 0) return null;
  await ensureContentGit();
  const repo = git();
  // Ein gelöschter Entwurf, der nie eine Fassung hatte, ist für git kein Pfad.
  const tracked = new Set((await repo.raw(["ls-files", "--", ...files])).split("\n").filter(Boolean));
  const present = await Promise.all(
    files.map((file) => fs.stat(path.join(contentDir(), file)).then(() => true, () => false)),
  );
  const known = files.filter((file, i) => present[i] || tracked.has(file));
  if (known.length === 0) return null;
  await repo.add(known);
  const staged = (await repo.diff(["--cached", "--name-only"])).trim();
  if (!staged) return null;
  const result = await repo.commit(message);
  return result.commit || null;
}

export async function logFile(rel: string): Promise<Revision[]> {
  await ensureContentGit();
  const repo = git();
  const result = await repo.raw(["log", "--follow", "--name-only", "--format=%x1e%H%x09%aI%x09%s", "--", rel]);
  return result
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [head = "", ...files] = entry.split("\n").map((line) => line.trim()).filter(Boolean);
      const [rev, date, ...rest] = head.split("\t");
      return { rev: rev ?? "", date: date ?? "", message: rest.join("\t"), path: files.at(-1) ?? rel };
    })
    .filter((item) => item.rev);
}

export async function showFile(rel: string, rev: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/i.test(rev)) throw new Error("Ungültige Fassung");
  if (rel.includes("..") || path.isAbsolute(rel)) throw new Error("Ungültiger Pfad");
  await ensureContentGit();
  return git().show([`${rev}:${rel}`]);
}

export async function restoreFile(rel: string, rev: string, from = rel): Promise<void> {
  const raw = await showFile(from, rev);
  const file = path.join(contentDir(), rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
}
