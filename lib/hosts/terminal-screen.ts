import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HostOpError } from "./link-protocol";
import { resolveSessionPath } from "../session-reader";

const exec = promisify(execFile);
export interface TerminalScreen { screen: string; columns: number; rows: number; exited: boolean }
export async function terminalScreen(id: string): Promise<TerminalScreen> {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new HostOpError(400, "invalid_session", "Invalid session identifier");
  if (!await resolveSessionPath(id)) throw new HostOpError(404, "session_not_found", "Session not found");
  const run = (args: string[]) => exec("tmux", ["-L", "ompweb", ...args], { timeout: 2500, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
  let listing: string;
  try { listing = (await run(["list-panes", "-a", "-F", "#{pane_id}\t#{@ompweb_session}\t#{pane_width}\t#{pane_height}\t#{pane_dead}"])).stdout; }
  catch { throw new HostOpError(404, "terminal_unavailable", "No mirrored terminal. Start this saved session with ompweb-tui on its host."); }
  const matches = listing.trim().split("\n").map(line => line.split("\t")).filter(fields => fields[1] === id);
  if (matches.length !== 1 || !/^%\d+$/.test(matches[0][0])) throw new HostOpError(404, "terminal_unavailable", "No mirrored terminal for this session. Start it with ompweb-tui on its host.");
  const [pane, , width, height, dead] = matches[0];
  const columns = Number(width), rows = Number(height);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || columns > 1000 || rows < 1 || rows > 500) throw new HostOpError(400, "terminal_size", "Unsupported terminal size");
  try {
    const { stdout } = await run(["capture-pane", "-p", "-e", "-N", "-t", pane]);
    return { screen: stdout, columns, rows, exited: dead === "1" };
  } catch { throw new HostOpError(503, "terminal_disconnected", "Terminal disconnected. Retrying…"); }
}
