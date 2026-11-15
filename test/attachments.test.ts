import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attachmentUri, promptAttachment, rangeAttachment } from "../src/util/attachments";

describe("attachmentUri", () => {
  test("keeps URIs the server already understands", () => {
    assert.equal(attachmentUri("file:///C:/work/a.ts"), "file:///C:/work/a.ts");
    assert.equal(attachmentUri("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
    assert.equal(attachmentUri("https://example.com/a.png"), "https://example.com/a.png");
  });

  test("converts local paths to file URLs", () => {
    const file = path.resolve("src", "index.ts");
    const uri = attachmentUri(file);
    assert.equal(uri, pathToFileURL(file).href);
    assert.match(uri, /^file:\/\//);
  });

  test(
    "converts Windows drive paths to file URLs",
    { skip: process.platform !== "win32" },
    () => {
      assert.equal(attachmentUri("h:\\MyCode\\a.png"), pathToFileURL("h:\\MyCode\\a.png").href);
      assert.equal(attachmentUri("h:/MyCode/a.png"), attachmentUri("h:\\MyCode\\a.png"));
      assert.match(attachmentUri("h:\\MyCode\\a.png"), /^file:\/\/\/[a-z]:\//i);
    },
  );

  test("inlines staged images", () => {
    const uri = attachmentUri("staged:img-1", {
      name: "shot.png",
      mime: "image/png",
      data: "QUJD",
    });
    assert.equal(uri, "data:image/png;base64,QUJD");
  });
});

describe("rangeAttachment", () => {
  test("narrows the file URL with the line range the server slices", () => {
    const file = path.resolve("src", "webview", "panel.ts");
    const attachment = rangeAttachment(file, "panel.ts", 120, 168);
    assert.equal(attachment.uri, `${pathToFileURL(file).href}?start=120&end=168`);
    assert.equal(attachment.description, "L120-L168");
    assert.equal(attachment.name, "panel.ts");
  });
});

describe("promptAttachment", () => {
  test("names the attachment after the file", () => {
    const file = path.resolve("src", "index.ts");
    assert.deepEqual(promptAttachment(file), {
      uri: pathToFileURL(file).href,
      name: "index.ts",
    });
  });

  test("prefers the staged image name", () => {
    const attachment = promptAttachment("staged:img-1", {
      name: "shot.png",
      mime: "image/jpeg",
      data: "QUJD",
    });
    assert.equal(attachment.name, "shot.png");
    assert.equal(attachment.uri, "data:image/jpeg;base64,QUJD");
  });
});
