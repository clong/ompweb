"use client";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export function TerminalView({ sessionId }: { sessionId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connecting to terminal…");
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const css = getComputedStyle(element);
    const term = new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 13, scrollback: 0,
      theme: { background: css.getPropertyValue("--bg").trim(), foreground: css.getPropertyValue("--text").trim() } });
    term.open(element);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    const poll = async () => {
      try {
        if (document.visibilityState === "visible") {
          const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/terminal`, { signal: controller.signal, cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Terminal unavailable");
          if (typeof data.screen !== "string" || !Number.isInteger(data.columns) || !Number.isInteger(data.rows) || data.columns < 1 || data.columns > 1000 || data.rows < 1 || data.rows > 500) throw new Error("Invalid terminal frame");
          term.resize(data.columns, data.rows);
          const identity = `${data.columns}:${data.rows}:${data.screen}`;
          if (identity !== previous) {
            previous = identity;
            term.write("\x1b[0m\x1b[2J\x1b[H" + data.screen.replace(/\r?\n/g, "\r\n") + "\x1b[?25l");
          }
          setStatus(data.exited ? "Terminal exited · last screen" : `Live terminal · ${data.columns} × ${data.rows} · view only`);
        }
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Terminal unavailable");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); term.dispose(); };
  }, [sessionId]);
  return <section aria-label="Live terminal" style={{ position: "absolute", inset: "42px 0 0", zIndex: 40, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
    <div role="status" style={{ padding: "8px 16px", color: "var(--text-muted)", fontSize: 12 }}>{status}</div>
    <div style={{ overflow: "auto", flex: 1, padding: 12 }} onKeyDown={event => event.stopPropagation()}><div ref={container} /></div>
  </section>;
}
