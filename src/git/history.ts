import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { schreibeAtomar } from "../content/atomar.ts";
import { contentDir } from "../paths.ts";

function git(): SimpleGit {
  // Nur PATH und HOME aus der Umgebung: die des Prozesses enthält Editor-Variablen, die simple-git
  // als unsicher ablehnt. Die Identität kommt als Konfiguration; GIT_AUTHOR_* blockiert simple-git 4.
  return simpleGit({
    baseDir: contentDir(),
    config: ["safe.directory=*", "user.name=Advocat Redaktion", "user.email=redaktion@advocat.local"],
  }).env({
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  });
}

/**
 * Git verträgt keine zwei Schreiber gleichzeitig (index.lock). Alles, was den Index anfasst,
 * läuft darum der Reihe nach: das Speichern nach 20 Sekunden und Veröffentlichen zur selben Zeit
 * ergeben zwei Fassungen statt eines Fehlers.
 */
let reihe: Promise<unknown> = Promise.resolve();

function nacheinander<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = reihe.then(arbeit, arbeit);
  reihe = lauf.catch(() => undefined);
  return lauf;
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
export function commitIfChanged(message: string, files: string[]): Promise<string | null> {
  if (files.length === 0) return Promise.resolve(null);
  return nacheinander(() => commitNow(message, files));
}

async function commitNow(message: string, files: string[]): Promise<string | null> {
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
  const staged = (await repo.diff(["--cached", "--name-only", "--", ...known])).trim();
  if (!staged) return null;
  // Nur diese Pfade: liegt sonst noch etwas im Index, gehört es nicht unter diese Nachricht.
  const result = await repo.commit(message, known);
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
  await schreibeAtomar(path.join(contentDir(), rel), raw.endsWith("\n") ? raw : `${raw}\n`);
}

export interface VerlaufEintrag {
  rev: string;
  date: string;
  message: string;
  /** Status (A, M, D) und Pfad. Umbenannt heisst hier: alt gelöscht, neu dazu. */
  dateien: { status: string; pfad: string }[];
}

/** Alle Fassungen des Inhalts, die neueste zuerst. */
export async function logAlles(limit: number, skip: number): Promise<VerlaufEintrag[]> {
  await ensureContentGit();
  const result = await git().raw(["log", `-n${limit}`, `--skip=${skip}`, "--no-merges", "--no-renames", "--name-status", "--format=%x1e%H%x09%aI%x09%s"]);
  return result
    .split("\x1e")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean)
    .map((eintrag) => {
      const [kopf = "", ...zeilen] = eintrag.split("\n").filter(Boolean);
      const [rev = "", date = "", ...rest] = kopf.split("\t");
      const dateien = zeilen.map((zeile) => {
        const [status = "", pfad = ""] = zeile.split("\t");
        return { status, pfad };
      });
      return { rev, date, message: rest.join("\t"), dateien };
    });
}

/** Holt eine Datei so zurück, wie sie in `rev` war. Für Bilder: Sie sind nicht Text. */
export function holeDateiZurueck(rel: string, rev: string): Promise<void> {
  if (!/^[0-9a-f]{7,40}(\^)?$/i.test(rev)) return Promise.reject(new Error("Ungültige Fassung"));
  if (rel.includes("..") || path.isAbsolute(rel)) return Promise.reject(new Error("Ungültiger Pfad"));
  return nacheinander(async () => {
    await git().raw(["restore", `--source=${rev}`, "--staged", "--worktree", "--", rel]);
  });
}

export async function gibtEsInFassung(rel: string, rev: string): Promise<boolean> {
  return git().raw(["cat-file", "-e", `${rev}:${rel}`]).then(() => true, () => false);
}
