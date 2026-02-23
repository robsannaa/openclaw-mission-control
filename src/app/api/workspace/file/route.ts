import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, normalize } from "path";
import { getDefaultWorkspace } from "@/lib/paths";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);

/**
 * GET /api/workspace/file?path=relative/path/to/file.png
 * Serves a single file from the workspace (e.g. for kanban task attachments).
 * Path must be relative to workspace root; no directory traversal (..) allowed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawPath = (searchParams.get("path") || "").trim();
  if (!rawPath) {
    return NextResponse.json(
      { error: "Missing required query param: path" },
      { status: 400 }
    );
  }

  const normalized = normalize(rawPath).replace(/\\/g, "/");
  if (normalized.startsWith("..") || normalized.includes("/..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const workspace = await getDefaultWorkspace();
    const fullPath = join(workspace, normalized);
    const content = await readFile(fullPath);

    const ext = normalized.toLowerCase().slice(normalized.lastIndexOf("."));
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const contentType = isImage
      ? (ext === ".svg"
          ? "image/svg+xml"
          : ext === ".ico"
            ? "image/x-icon"
            : ext === ".jpg"
              ? "image/jpeg"
              : `image/${ext.slice(1)}`)
      : "application/octet-stream";

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found or not readable" },
      { status: 404 }
    );
  }
}
