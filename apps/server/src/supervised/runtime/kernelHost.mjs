import readline from "node:readline";

const state = Object.create(null);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  let request;
  try {
    request = JSON.parse(line);
    const fn = new AsyncFunction(
      "state",
      "input",
      `"use strict";\n${request.code}\n`,
    );
    const result = await fn(state, request.input ?? null);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        id: request?.id ?? "unknown",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
  }
}
