import test from "node:test";
import assert from "node:assert/strict";
import { authorizeGquali } from "../lib/gquali-auth";
const token = "test-credential-".padEnd(40, "x");
const request = (value = token) => new Request("https://example.test/api/integrations/gquali/rncs", { headers: { authorization: `Bearer ${value}` } });
test("disabled without dedicated configuration, including missing work scope", () => {
  assert.equal(authorizeGquali(request(), {}), null);
  assert.equal(authorizeGquali(request(), { GQUALI_READ_TOKEN: token }), null);
});
test("rejects incorrect credential and malformed scopes", () => {
  assert.equal(authorizeGquali(request("wrong"), { GQUALI_READ_TOKEN: token, GQUALI_WORK_IDS: "1" }), null);
  for (const scope of ["*", "0", "1,", "1e3", "9007199254740992"]) assert.equal(authorizeGquali(request(), { GQUALI_READ_TOKEN: token, GQUALI_WORK_IDS: scope }), null);
});
test("returns only explicitly allowed works", () => {
  assert.deepEqual(authorizeGquali(request(), { GQUALI_READ_TOKEN: token, GQUALI_WORK_IDS: "1,2,1" }), [1,2]);
});
