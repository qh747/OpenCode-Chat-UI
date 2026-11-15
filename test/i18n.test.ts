import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  getLocale,
  messages,
  resolveLocale,
  setLocale,
  t,
  translate,
} from "../src/util/i18n";

test("the module starts in English", () => {
  setLocale("zh-cn");
  setLocale("en");
  assert.equal(getLocale(), "en");
});

describe("locale resolution", () => {
  test("zh-cn spellings and plain zh map to the zh-cn dictionary", () => {
    assert.equal(resolveLocale("zh-cn"), "zh-cn");
    assert.equal(resolveLocale("zh-CN"), "zh-cn");
    assert.equal(resolveLocale("zh"), "zh-cn");
    assert.equal(resolveLocale("zh-hans"), "zh-cn");
    assert.equal(resolveLocale("zh-hans-sg"), "zh-cn");
  });

  test("other zh variants fall back to English for now", () => {
    assert.equal(resolveLocale("zh-tw"), "en");
    assert.equal(resolveLocale("zh-hant"), "en");
  });

  test("anything else falls back to English", () => {
    assert.equal(resolveLocale("en"), "en");
    assert.equal(resolveLocale("en-US"), "en");
    assert.equal(resolveLocale("fr"), "en");
    assert.equal(resolveLocale(""), "en");
  });
});

describe("dictionaries", () => {
  test("both locales define the same keys, none empty", () => {
    const en = Object.keys(messages.en).sort();
    const zh = Object.keys(messages["zh-cn"]).sort();
    assert.deepEqual(zh, en);
    for (const dictionary of [messages.en, messages["zh-cn"]]) {
      for (const [key, value] of Object.entries(dictionary)) {
        assert.ok(value.length > 0, `${key} is empty`);
      }
    }
  });
});

describe("translate", () => {
  test("picks the string from the requested locale", () => {
    assert.equal(translate("en", "retry"), "Retry");
    assert.equal(translate("zh-cn", "retry"), "重试");
  });

  test("interpolates {vars}", () => {
    assert.equal(translate("en", "attachmentsCount", { count: 2 }), "2 attachments");
    assert.equal(translate("zh-cn", "attachmentsCount", { count: 2 }), "附件 2");
  });

  test("keeps an unmatched placeholder as-is", () => {
    assert.equal(translate("en", "attachmentsCount"), "{count} attachments");
  });

  test("an unknown key returns the key itself", () => {
    assert.equal(translate("en", "no.such.key" as never), "no.such.key");
  });
});

describe("module locale", () => {
  test("t() uses the locale set with setLocale", () => {
    setLocale("zh-cn");
    assert.equal(getLocale(), "zh-cn");
    assert.equal(t("retry"), "重试");
    setLocale("en");
    assert.equal(t("retry"), "Retry");
  });
});
