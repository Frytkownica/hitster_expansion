const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const threshold = source.match(/const PHONE_FLIP_THRESHOLD = \d+;/)?.[0];
const helper = source.match(/function isFaceDown\(beta, gamma\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(threshold && helper, "face-down gate must exist");

const context = {};
vm.runInNewContext(`${threshold}\n${helper}\nresult = isFaceDown;`, context);
const isFaceDown = context.result;

assert.equal(isFaceDown(90, 0), false, "upright scanning must not reveal the song");
assert.equal(isFaceDown(175, 5), true, "face-down must reveal the song");
assert.equal(isFaceDown(null, null), false, "missing sensor data must stay blocked");
