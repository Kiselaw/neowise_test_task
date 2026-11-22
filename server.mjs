import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { triage } from "./triage.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {Record<string, unknown>} body
 * @returns {void}
 */
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @returns {Promise<void>}
 */
async function handleTriage(request, response) {
  /** @type {unknown} */
  let input;
  try {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("text" in input) ||
    typeof input.text !== "string" ||
    input.text.trim().length === 0
  ) {
    return json(response, 400, { status: "invalid_input" });
  }

  json(response, 200, await triage(input.text.trim()));
}

/**
 * Create an HTTP server without binding a port, so tests can use a free port.
 * @returns {import("node:http").Server}
 */
export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
