import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../deploy/hosted.index.html", import.meta.url), "utf8");
const nginx = await readFile(new URL("../deploy/hosted.nginx.conf", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];

test("the landing page's inline code matches its strict Nginx CSP", () => {
  const policy = nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/)[1];
  assert.match(policy, /default-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy));
  for (const tag of ["style", "script"]) {
    const blocks = [...html.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "gi"))];
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      const hash = createHash("sha256").update(block[1]).digest("base64");
      assert.ok(policy.includes("'sha256-" + hash + "'"), tag + " would be blocked by CSP");
    }
  }
});

for (const mode of ["allowed", "denied", "unavailable"]) {
  test("the actual copy handler handles clipboard access: " + mode, async () => {
    const endpoint = html.match(/<code id="mcp-url">([^<]+)<\/code>/)[1];
    const status = { textContent: "" };
    let handler, copied;
    const nodes = {
      "#copy-url": { addEventListener: (event, action) => { assert.equal(event, "click"); handler = action; } },
      "#mcp-url": { textContent: endpoint },
      "#copy-status": status,
    };
    const clipboard = mode === "unavailable" ? undefined : {
      writeText: async value => {
        if (mode === "denied") throw new Error("Clipboard access denied");
        copied = value;
      },
    };
    runInNewContext(script, { document: { querySelector: selector => nodes[selector] }, navigator: { clipboard } });
    await handler();
    if (mode === "allowed") {
      assert.equal(copied, endpoint);
      assert.match(status.textContent, /copied/i);
    } else {
      assert.equal(copied, undefined);
      assert.match(status.textContent, /blocked.*select.*copy/i);
    }
  });
}
