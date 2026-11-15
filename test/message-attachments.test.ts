import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  appendLinks,
  attachmentTarget,
  describeAttachment,
  describeAttachments,
  extractLinks,
  linkName,
} from "../src/util/message-attachments";
import type { StoredFileAttachment } from "../src/opencode/types";

function file(overrides: Partial<StoredFileAttachment> = {}): StoredFileAttachment {
  return {
    data: "",
    mime: "text/markdown",
    name: "CHANGELOG.md",
    source: { type: "uri", uri: "file:///h:/MyCode/opencode-plugin/CHANGELOG.md" },
    ...overrides,
  };
}

describe("extractLinks", () => {
  test("pulls the host's marker lines out of the message text", () => {
    const { body, links } = extractLinks(
      "这个文件的作用是什么\n\n参考链接: https://example.com/a\n参考链接: https://example.com/b",
    );

    assert.equal(body, "这个文件的作用是什么");
    assert.deepEqual(links, ["https://example.com/a", "https://example.com/b"]);
  });

  test("leaves a message without links untouched", () => {
    const { body, links } = extractLinks("just text");

    assert.equal(body, "just text");
    assert.deepEqual(links, []);
  });

  test("keeps the links in the order they were added", () => {
    const { links } = extractLinks("hi\n\n参考链接: https://a.test\n参考链接: https://b.test");

    assert.deepEqual(links, ["https://a.test", "https://b.test"]);
  });

  test("round-trips what appendLinks wrote", () => {
    const text = appendLinks("body", ["https://a.test", "https://b.test"]);

    assert.deepEqual(extractLinks(text), {
      body: "body",
      links: ["https://a.test", "https://b.test"],
    });
  });

  test("does not treat a marker in the middle of the text as a link", () => {
    const { body, links } = extractLinks("参考链接: https://a.test\n\nstill body");

    assert.equal(body, "参考链接: https://a.test\n\nstill body");
    assert.deepEqual(links, []);
  });
});

describe("linkName", () => {
  test("names a link after its host", () => {
    assert.equal(linkName("https://github.com/anomalyco/opencode/pull/1"), "github.com");
  });

  test("drops a leading www", () => {
    assert.equal(linkName("https://www.example.com/a"), "example.com");
  });

  test("falls back to the whole url when it does not parse", () => {
    assert.equal(linkName("not a url"), "not a url");
  });
});

describe("describeAttachment", () => {
  test("a file names itself and carries the path it opens", () => {
    const item = describeAttachment(file());

    assert.equal(item.kind, "file");
    assert.equal(item.name, "CHANGELOG.md");
    assert.equal(item.path, "h:/MyCode/opencode-plugin/CHANGELOG.md");
  });

  test("an image gets a thumbnail from its own base64 data", () => {
    const item = describeAttachment(
      file({ mime: "image/png", name: "shot.png", data: "QUJD" }),
    );

    assert.equal(item.kind, "image");
    assert.equal(item.image, "data:image/png;base64,QUJD");
    assert.equal(item.mime, "image/png");
  });

  test("a selection keeps the line range the host wrote", () => {
    const item = describeAttachment(
      file({
        name: "panel.ts",
        description: "L120-L168",
        source: { type: "uri", uri: "file:///h:/w/panel.ts?start=120&end=168" },
      }),
    );

    assert.equal(item.kind, "selection");
    assert.equal(item.start, 120);
    assert.equal(item.end, 168);
    assert.match(item.detail ?? "", /L120-L168/);
  });

  test("a selection is recognised from the uri when the description is missing", () => {
    const item = describeAttachment(
      file({
        description: undefined,
        source: { type: "uri", uri: "file:///h:/w/panel.ts?start=4&end=9" },
      }),
    );

    assert.equal(item.kind, "selection");
    assert.equal(item.start, 4);
    assert.equal(item.end, 9);
  });

  test("an inline attachment that is not an image has no path to open", () => {
    const item = describeAttachment(file({ source: { type: "inline" } }));

    assert.equal(item.path, undefined);
    assert.equal(item.kind, "file");
  });
});

describe("describeAttachments", () => {
  test("puts the files first and the links last", () => {
    const items = describeAttachments([file()], ["https://example.com/a"]);

    assert.deepEqual(
      items.map((item) => item.kind),
      ["file", "url"],
    );
  });

  test("a link row opens in the browser, not the editor", () => {
    const [link] = describeAttachments(undefined, ["https://example.com/a"]);

    assert.equal(link?.kind, "url");
    assert.equal(link?.url, "https://example.com/a");
    assert.equal(link?.path, undefined);
  });

  test("no attachments and no links means nothing to show", () => {
    assert.deepEqual(describeAttachments(undefined, []), []);
  });
});

describe("attachmentTarget", () => {
  test("a pasted image is previewed — it has no place to open", () => {
    const item = describeAttachment(
      file({ mime: "image/png", name: "shot.png", data: "QUJD" }),
    );
    const target = attachmentTarget(item);

    assert.equal(target?.kind, "preview");
  });

  test("a file opens in the editor", () => {
    const target = attachmentTarget(describeAttachment(file()));

    assert.deepEqual(target, {
      kind: "file",
      path: "h:/MyCode/opencode-plugin/CHANGELOG.md",
      start: undefined,
      end: undefined,
    });
  });

  test("a selection opens at the lines it points at", () => {
    const item = describeAttachment(
      file({
        name: "panel.ts",
        description: "L120-L168",
        source: { type: "uri", uri: "file:///h:/w/panel.ts?start=120&end=168" },
      }),
    );
    const target = attachmentTarget(item);

    assert.deepEqual(target, {
      kind: "file",
      path: "h:/w/panel.ts",
      start: 120,
      end: 168,
    });
  });

  test("a link opens in the browser", () => {
    const [link] = describeAttachments(undefined, ["https://example.com/a"]);

    assert.deepEqual(attachmentTarget(link!), { kind: "url", url: "https://example.com/a" });
  });

  test("an attachment with nowhere to go has no target", () => {
    const item = describeAttachment(file({ source: { type: "inline" } }));

    assert.equal(attachmentTarget(item), undefined);
  });
});
