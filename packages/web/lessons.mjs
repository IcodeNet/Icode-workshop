import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { stepLayout } from "../core/layout.mjs";

// Render the course's declarative MDX subset without evaluating arbitrary JSX/JS.
export function lessonMarkdown(source) {
  const blocks = source.split(/(```[\s\S]*?```)/g);
  return blocks
    .map((block, index) =>
      index % 2
        ? block
        : block
            .replace(
              /<EpicVideo\s+url="([^"]+)"\s*\/>/g,
              (_, url) =>
                `[Watch the original lesson video (authorised access may be required)](${url})`,
            )
            .replace(
              /<InlineFile\s+file="([^"]+)"\s*\/>/g,
              (_, file) => `[${file}](#file=${encodeURIComponent(file)})`,
            )
            .replace(
              /<InlineFile\s+file="([^"]+)"[^>]*>([\s\S]*?)<\/InlineFile>/g,
              (_, file, label) =>
                `[${label}](#file=${encodeURIComponent(file)})`,
            )
            .replace(
              /<(?:NextDiffLink|PrevDiffLink|DiffLink)[^>]*>([\s\S]*?)<\/(?:NextDiffLink|PrevDiffLink|DiffLink)>/g,
              "[$1](#comparison)",
            )
            .replace(/<summary>([\s\S]*?)<\/summary>/g, "\n### $1\n")
            .replace(/<\/?(?:details|callout-[\w-]+)[^>]*>/g, "\n")
            .replace(/\{['"] ['"]\}/g, " "),
    )
    .join("");
}
export async function lessonDocuments(root, id) {
  const layout = stepLayout(root, id);
  const candidates = layout.epic
    ? [
        ["Course introduction", join(root, "exercises", "README.mdx")],
        ["Exercise introduction", join(layout.base, "README.mdx")],
        ["Problem lesson", join(layout.problem, "README.mdx")],
        ["Solution explanation", join(layout.solution, "README.mdx")],
        ["Exercise wrap-up", join(layout.base, "FINISHED.mdx")],
        ["Course wrap-up", join(root, "exercises", "FINISHED.mdx")],
      ]
    : [["Lesson", join(layout.base, "README.md")]];
  const documents = [];
  for (const [title, path] of candidates) {
    try {
      const source = await readFile(path, "utf8");
      documents.push({
        title,
        path: relative(root, path).replaceAll("\\", "/"),
        content: lessonMarkdown(source),
      });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return documents;
}
export async function lessonText(root, id) {
  const docs = await lessonDocuments(root, id);
  return (
    (docs.find((d) => d.title === "Problem lesson") || docs[0])?.content || ""
  );
}
