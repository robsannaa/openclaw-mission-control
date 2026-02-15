import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, writeFile, stat, unlink, rename, copyFile } from "fs/promises";
import { join, extname, basename } from "path";
import { getDefaultWorkspaceSync } from "@/lib/paths";

const WORKSPACE = getDefaultWorkspaceSync();

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, content } = body;
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    if (file) {
      const safePath = String(file).replace(/\.\./g, "").replace(/^\/+/, "");
      if (!safePath.endsWith(".md")) {
        return NextResponse.json({ error: "invalid file" }, { status: 400 });
      }
      const fullPath = join(WORKSPACE, "memory", safePath);
      await writeFile(fullPath, content, "utf-8");
      const words = content.split(/\s+/).filter(Boolean).length;
      const size = Buffer.byteLength(content, "utf-8");
      return NextResponse.json({ ok: true, file: safePath, words, size });
    }
    const fullPath = join(WORKSPACE, "MEMORY.md");
    await writeFile(fullPath, content, "utf-8");
    const words = content.split(/\s+/).filter(Boolean).length;
    const size = Buffer.byteLength(content, "utf-8");
    return NextResponse.json({ ok: true, file: "MEMORY.md", words, size });
  } catch (err) {
    console.error("Memory PUT error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE a memory journal file */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");
    if (!file) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const safePath = String(file).replace(/\.\./g, "").replace(/^\/+/, "");
    if (!safePath.endsWith(".md")) {
      return NextResponse.json({ error: "invalid file" }, { status: 400 });
    }
    const fullPath = join(WORKSPACE, "memory", safePath);
    const s = await stat(fullPath);
    if (!s.isFile()) {
      return NextResponse.json({ error: "not a file" }, { status: 400 });
    }
    await unlink(fullPath);
    return NextResponse.json({ ok: true, file: safePath, deleted: true });
  } catch (err) {
    console.error("Memory DELETE error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** PATCH - rename or duplicate a memory journal file */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, file: fileName, newName } = body as {
      action: "rename" | "duplicate";
      file: string;
      newName?: string;
    };
    if (!fileName || !action) {
      return NextResponse.json({ error: "action and file required" }, { status: 400 });
    }
    const safePath = String(fileName).replace(/\.\./g, "").replace(/^\/+/, "");
    const fullPath = join(WORKSPACE, "memory", safePath);

    if (action === "rename") {
      if (!newName) {
        return NextResponse.json({ error: "newName required" }, { status: 400 });
      }
      const sanitized = newName.replace(/[/\\:*?"<>|]/g, "").trim();
      if (!sanitized) {
        return NextResponse.json({ error: "invalid name" }, { status: 400 });
      }
      const newFullPath = join(WORKSPACE, "memory", sanitized);
      await rename(fullPath, newFullPath);
      return NextResponse.json({ ok: true, file: sanitized, oldFile: safePath });
    }

    if (action === "duplicate") {
      const ext = extname(safePath);
      const base = basename(safePath, ext);
      let suffix = 1;
      let dupPath: string;
      do {
        dupPath = join(WORKSPACE, "memory", `${base} (copy${suffix > 1 ? ` ${suffix}` : ""})${ext}`);
        suffix++;
      } while (
        await stat(dupPath)
          .then(() => true)
          .catch(() => false)
      );
      await copyFile(fullPath, dupPath);
      const dupName = basename(dupPath);
      return NextResponse.json({ ok: true, file: dupName });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("Memory PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  try {
    if (file) {
      const safePath = file.replace(/\.\./g, "").replace(/^\/+/, "");
      const fullPath = join(WORKSPACE, "memory", safePath);
      const content = await readFile(fullPath, "utf-8");
      const words = content.split(/\s+/).filter(Boolean).length;
      const size = Buffer.byteLength(content, "utf-8");
      return NextResponse.json({ content, words, size, file: safePath });
    }

    const memoryDir = join(WORKSPACE, "memory");
    const list: { name: string; date: string; size?: number; words?: number; mtime?: string }[] = [];
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name)
        .sort()
        .reverse();

      for (const name of files.slice(0, 50)) {
        try {
          const fullPath = join(memoryDir, name);
          const content = await readFile(fullPath, "utf-8");
          const s = await stat(fullPath);
          const words = content.split(/\s+/).filter(Boolean).length;
          // Extract the date portion (YYYY-MM-DD) from filenames like 2026-02-14-1139.md
          const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})/);
          const date = dateMatch ? dateMatch[1] : name.replace(".md", "");
          list.push({
            name,
            date,
            size: Buffer.byteLength(content, "utf-8"),
            words,
            mtime: s.mtime.toISOString(),
          });
        } catch {
          const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})/);
          list.push({ name, date: dateMatch ? dateMatch[1] : name.replace(".md", "") });
        }
      }
    } catch {
      // memory/ may not exist
    }

    let memoryMd: string | null = null;
    let memoryMtime: string | undefined;
    try {
      memoryMd = await readFile(join(WORKSPACE, "MEMORY.md"), "utf-8");
      const s = await stat(join(WORKSPACE, "MEMORY.md"));
      memoryMtime = s.mtime.toISOString();
    } catch {
      // MEMORY.md optional
    }

    return NextResponse.json({
      daily: list,
      memoryMd: memoryMd
        ? {
            content: memoryMd,
            words: memoryMd.split(/\s+/).filter(Boolean).length,
            size: Buffer.byteLength(memoryMd, "utf-8"),
            mtime: memoryMtime,
          }
        : null,
    });
  } catch (err) {
    console.error("Memory API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
