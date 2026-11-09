# View the OMP terminal in the portal

The Chat / TUI switch opens a read-only view of the session's actual tmux screen. The host captures the terminal's character cells and ANSI colors once per second while the view is visible. The browser keeps the host terminal's dimensions and permits horizontal scrolling on small screens. It does not reconstruct the display from saved chat messages, and switching views never starts or interrupts OMP.

This is a screen mirror, not keyboard control or a recording of every repaint. Native terminal images and local font rendering may differ. Use Chat for transcript history and your terminal for keyboard input. OMP processes launched in RPC mode or a plain terminal have no tmux screen; the TUI tab explains when a mirrored terminal is unavailable.

## Launch a saved session in a mirrored terminal

Install tmux on the OMP host and install `scripts/ompweb-tui.py` as `ompweb-tui`. Stop the session's existing process cleanly first; the launcher refuses sessions with a held or unknown OMP lease. Preserve the session's configuration overlays:

```sh
ompweb-tui /absolute/path/to/session.jsonl --config /absolute/path/to/routing.yml
```

Add `--restore` to continue interrupted work, or omit it to open the conversation awaiting input. `--prewalk` preserves an explicitly enabled prewalk setting. Terminal dimensions default to 160 columns by 50 rows and can be set with `--width` and `--height`. The launcher prints the local tmux attach command. For a new conversation, create and save it in OMP first, then use the same launcher on its session file.

The launcher uses a separate tmux socket named `ompweb` and marks the pane with its session UUID. The host only captures a unique pane with that exact UUID after confirming the saved session exists. Arbitrary pane names, shell commands, resizing, and input are not accepted by the API. Terminal data uses the existing authenticated host link and portal login; it is not published to an external relay. The API sends `Cache-Control: no-store`.

Both the web server and the host daemon need this fork's terminal-screen capability. Older hosts return an explicit upgrade message. Updating a host daemon requires checking that it owns no active OMP children before restarting it. The terminal itself lives independently in tmux, so web-service restarts do not stop its agent.
