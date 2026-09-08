import assert from "node:assert/strict";
import test from "node:test";
import { toastChrome } from "./toast";
import type { ToastTone } from "./types";

const TONES: ToastTone[] = ["error", "info", "success", "warn"];

test("toast chrome differs by tone", () => {
  const error = toastChrome("error");
  const info = toastChrome("info");
  const success = toastChrome("success");
  const warn = toastChrome("warn");

  assert.equal(error.label, "Error");
  assert.equal(info.label, "Info");
  assert.equal(success.label, "Done");
  assert.equal(warn.label, "Warning");

  assert.match(error.kicker, /--err/);
  assert.match(info.kicker, /--blue/);
  assert.match(success.kicker, /--teal/);
  assert.match(warn.kicker, /--warn/);

  assert.match(error.panel, /--err/);
  assert.match(info.panel, /--blue/);
  assert.match(success.panel, /--teal/);
  assert.match(warn.panel, /--warn/);

  const kickers = TONES.map((tone) => toastChrome(tone).kicker);
  const panels = TONES.map((tone) => toastChrome(tone).panel);
  const labels = TONES.map((tone) => toastChrome(tone).label);
  assert.equal(new Set(kickers).size, TONES.length);
  assert.equal(new Set(panels).size, TONES.length);
  assert.equal(new Set(labels).size, TONES.length);
});

test("supports toast action execution", () => {
  let executed = false;
  const actionToast = {
    id: "toast-1",
    title: "Enhancement ready for review",
    body: "Video is ready",
    tone: "success" as const,
    action: {
      label: "Review",
      onClick: () => {
        executed = true;
      },
    },
  };

  assert.equal(actionToast.action.label, "Review");
  actionToast.action.onClick();
  assert.equal(executed, true);
});
