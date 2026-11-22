import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "the page contains its executable module");

/** @typedef {{ok: boolean, status: number, json: () => Promise<unknown>}} Reply */
/** @typedef {(event: {preventDefault: () => void}) => Promise<void>} SubmitHandler */

/**
 * Execute the real page script with only its DOM and network boundaries replaced.
 * This tests UI state transitions, not browser layout or accessibility.
 * @param {() => Promise<Reply>} fetchReply
 * @returns {{message: {value: string}, button: {disabled: boolean}, result: {textContent: string}, panel: {hidden: boolean}, topic: {textContent: string}, draft: {textContent: string}, submit: () => Promise<void>}}
 */
function createPage(fetchReply) {
  /** @type {SubmitHandler | undefined} */
  let submitHandler;
  const message = { value: "Когда доставка?" };
  const button = { disabled: false };
  const result = { textContent: "" };
  const panel = { hidden: true };
  const topic = { textContent: "" };
  const draft = { textContent: "" };
  const form = {
    /** @param {string} type @param {SubmitHandler} handler @returns {void} */
    addEventListener(type, handler) {
      assert.equal(type, "submit");
      submitHandler = handler;
    },
  };
  const elements = {
    form,
    "#message": message,
    'button[type="submit"]': button,
    "#result": result,
    "#draft-panel": panel,
    "#topic": topic,
    "#draft": draft,
  };
  runInNewContext(script, {
    document: {
      /** @param {keyof typeof elements} selector @returns {typeof elements[keyof typeof elements]} */
      querySelector(selector) {
        assert.ok(Object.hasOwn(elements, selector), `unexpected selector ${selector}`);
        return elements[selector];
      },
    },
    fetch: fetchReply,
  });
  assert.equal(typeof submitHandler, "function");
  return {
    message, button, result, panel, topic, draft,
    /** @returns {Promise<void>} */
    async submit() {
      return submitHandler({
        /** @returns {void} */
        preventDefault() {},
      });
    },
  };
}

/** @param {unknown} body @param {number} [status] @returns {Reply} */
function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ready = { status: "ready", topic: "delivery", draft: "Спасибо, проверим доставку." };

test("shows the topic and draft after a successful response", async () => {
  const page = createPage(async () => reply(ready));
  await page.submit();
  assert.equal(page.panel.hidden, false);
  assert.ok(page.topic.textContent.trim());
  assert.equal(page.draft.textContent, ready.draft);
  assert.equal(page.button.disabled, false);
});

for (const [name, failure] of [
  ["manual review", reply({ status: "manual_review", topic: null, draft: null })],
  ["HTTP failure", reply({ status: "server_error" }, 500)],
  ["invalid model topic", reply({ status: "ready", topic: "refund", draft: "Old answer" })],
  ["empty model draft", reply({ status: "ready", topic: "other", draft: "  " })],
  ["null response", reply(null)],
  ["network failure", new Error("Connection lost")],
  ["non-JSON response", { ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } }],
]) {
  test(`clears the previous draft after ${name}`, async () => {
    let requests = 0;
    const page = createPage(async () => {
      requests += 1;
      if (requests === 1) return reply(ready);
      if (failure instanceof Error) throw failure;
      return failure;
    });
    await page.submit();
    assert.equal(page.draft.textContent, ready.draft);
    await page.submit();
    assert.equal(page.draft.textContent, "");
    assert.equal(page.topic.textContent, "");
    assert.equal(page.panel.hidden, true);
    assert.match(page.result.textContent, /вручную|ручн/);
    assert.equal(page.button.disabled, false);
  });
}

test("rejects whitespace locally and clears an earlier draft", async () => {
  let requests = 0;
  const page = createPage(async () => { requests += 1; return reply(ready); });
  await page.submit();
  page.message.value = " \n\t ";
  await page.submit();
  assert.equal(requests, 1);
  assert.equal(page.draft.textContent, "");
  assert.equal(page.topic.textContent, "");
  assert.equal(page.panel.hidden, true);
  assert.match(page.result.textContent, /Введите|введите|пуст/);
  assert.equal(page.button.disabled, false);
});

test("clears stale content while loading and prevents overlapping requests", async () => {
  /** @type {(response: Reply) => void} */
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  let requests = 0;
  const page = createPage(async () => { requests += 1; return pending; });
  page.draft.textContent = "Предыдущий ответ";
  page.topic.textContent = "Предыдущая тема";
  page.panel.hidden = false;
  const first = page.submit();
  assert.equal(page.button.disabled, true);
  assert.equal(page.draft.textContent, "");
  assert.equal(page.topic.textContent, "");
  assert.equal(page.panel.hidden, true);
  await page.submit();
  assert.equal(requests, 1);
  complete(reply(ready));
  await first;
  assert.equal(page.draft.textContent, ready.draft);
  assert.equal(page.button.disabled, false);
});
