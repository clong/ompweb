import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import React from "react";
const { cleanup, render, screen } = await import("@testing-library/react/pure.js");
const { default: userEvent } = await import("@testing-library/user-event");

const { ChatInput } = await import("./ChatInput.tsx");
const enModule = await import("@/lib/i18n/locales/en.json");
const en = enModule.default ?? enModule;

beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.matchMedia;
});

function renderFast(props) {
  const changes = [];
  render(React.createElement(ChatInput, {
    async onSend() { return { status: "accepted" }; },
    onAbort() {},
    isStreaming: false,
    fastModeSupported: true,
    onFastModeChange: (enabled) => { changes.push(enabled); },
    ...props,
  }));
  return { changes, button: screen.getByRole("button", { name: en["chatInput.fastLabel"] }) };
}

for (const enabled of [true, false]) {
  test(`clicking the ${enabled ? "pressed" : "unpressed"} Fast toggle asks for ${!enabled}`, async () => {
    const user = userEvent.setup();
    const { changes, button } = renderFast({ fastModeEnabled: enabled });
    assert.equal(button.getAttribute("aria-pressed"), String(enabled));
    await user.click(button);
    assert.deepEqual(changes, [!enabled]);
  });
}

test("the Fast toggle is disabled and inert while a run streams", async () => {
  const user = userEvent.setup();
  const { changes, button } = renderFast({ fastModeEnabled: false, isStreaming: true });
  assert.equal(button.disabled, true);
  await user.click(button);
  assert.deepEqual(changes, []);
});

test("Fast uses a lightning icon, describes priority, and replaces the Slow control", () => {
  const { button } = renderFast({ fastModeEnabled: false });
  assert.ok(button.querySelector("svg"));
  assert.match(button.title, /priority processing/);
  assert.equal(screen.queryByRole("button", { name: en["chatInput.slowLabel"] }), null);
});

test("the Fast toggle reports when OMP enabled it but the active model cannot realize it", () => {
  const { button } = renderFast({ fastModeEnabled: true, fastModeActive: false });
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.match(button.title, /inactive for this model/);
});
