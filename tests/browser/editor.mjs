// The Playground editor is a CodeMirror contenteditable, not a textarea:
// Playwright's inputValue() does not apply, so its text is read from the
// editor element's read-only `value`.
import { expect } from "@playwright/test";

export const editorText = (page) =>
  page.getByRole("textbox", { name: "Playground code editor" }).evaluate((editor) => editor.value);
export const expectEditor = (page) => expect.poll(() => editorText(page));
/** Replace the editor's whole text, as a learner selecting all and typing would. */
export async function fillEditor(page, text) {
  const content = page.getByRole("textbox", { name: "Playground code editor" });
  await expect(content).toBeEditable();
  await content.focus();
  await page.keyboard.press("ControlOrMeta+a");
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press("Delete");
  await expect.poll(() => editorText(page)).toBe(text);
}
