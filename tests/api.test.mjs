import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createApp } from "../server.mjs";

/** @type {import("node:http").Server} */
let server;
let baseUrl = "";

before(async () => {
  server = createApp();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

/**
 * Send an actual HTTP request, including intentionally malformed JSON.
 * @param {string} body
 * @returns {Promise<{status: number, body: unknown}>}
 */
async function post(body) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  return { status: response.status, body: await response.json() };
}

for (const [label, body] of [
  ["empty body", ""],
  ["malformed JSON", "{broken"],
  ["missing text", "{}"],
  ["empty text", '{"text":""}'],
  ["whitespace text", '{"text":"  \\n\\t "}'],
  ["null text", '{"text":null}'],
  ["numeric text", '{"text":42}'],
  ["boolean text", '{"text":false}'],
  ["object text", '{"text":{}}'],
  ["array text", '{"text":[]}'],
  ["null root", "null"],
  ["array root", "[]"],
  ["string root", '"hello"'],
]) {
  test(`rejects ${label} with HTTP 400`, async () => {
    assert.deepEqual(await post(body), {
      status: 400,
      body: { status: "invalid_input" },
    });
  });
}

for (const [text, topic] of [
  ["Когда доставка?", "delivery"],
  ["Какая стоимость?", "pricing"],
  ["Здравствуйте", "other"],
]) {
  test(`returns a validated ready result for ${topic}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      status: 200,
      body: {
        status: "ready",
        topic,
        draft: "Спасибо за обращение. Уточним детали заявки.",
      },
    });
  });
}

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`falls back to manual review for ${marker}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text: marker })), {
      status: 200,
      body: { status: "manual_review", topic: null, draft: null },
    });
  });
}

test("stops waiting for a slow model before its 1200 ms delay finishes", { timeout: 2000 }, async () => {
  const start = performance.now();
  const response = await post(JSON.stringify({ text: "[timeout]" }));
  const elapsed = performance.now() - start;
  assert.deepEqual(response, {
    status: 200,
    body: { status: "manual_review", topic: null, draft: null },
  });
  assert.ok(elapsed < 1000, `model timeout took ${elapsed.toFixed(0)} ms`);
});

test("continues handling valid requests after a model failure", async () => {
  await post(JSON.stringify({ text: "[error]" }));
  const response = await post(JSON.stringify({ text: "Доставка" }));
  assert.deepEqual(response, {
    status: 200,
    body: {
      status: "ready",
      topic: "delivery",
      draft: "Спасибо за обращение. Уточним детали заявки.",
    },
  });
});
