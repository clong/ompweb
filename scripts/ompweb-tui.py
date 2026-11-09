#!/usr/bin/env python3
"""Run a saved OMP session in a private, portal-readable tmux terminal."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import uuid

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('session', help='Saved session JSONL path')
p.add_argument('--restore', action='store_true', help='Continue interrupted work after opening')
p.add_argument('--config', action='append', default=[])
p.add_argument('--prewalk', action='store_true')
p.add_argument('--width', type=int, default=160)
p.add_argument('--height', type=int, default=50)
a = p.parse_args()
source = Path(a.session).resolve(strict=True)
header = next(json.loads(line) for line in source.open() if json.loads(line).get('type') == 'session')
sid = str(uuid.UUID(header['id']))
cwd = Path(header['cwd']).resolve(strict=True)
lease = json.loads(subprocess.check_output(['omp', 'session', 'lease', '--json', '--', sid], text=True))
if lease.get('held') or lease.get('unknown'):
    raise SystemExit('Session is still owned by another process or its ownership is unknown. Stop it cleanly first.')
if not (40 <= a.width <= 400 and 10 <= a.height <= 150):
    raise SystemExit('Terminal dimensions out of range')
tmux = ['tmux', '-L', 'ompweb']
name = 'ompweb-' + sid
if subprocess.run(tmux + ['has-session', '-t', name], capture_output=True).returncode == 0:
    raise SystemExit('Mirrored terminal already exists; attach with: tmux -L ompweb attach -t ' + name)
command = ['omp']
for config in a.config:
    command += ['--config', str(Path(config).resolve(strict=True))]
if a.prewalk:
    command += ['--prewalk']
command += ['--restore' if a.restore else '--resume', str(source)]
# The barrier allows metadata and remain-on-exit to be set before OMP starts.
barrier = 'start-' + sid
shell = shlex.join(tmux + ['wait-for', barrier]) + '; exec env COLORTERM=truecolor ' + shlex.join(command)
pane = subprocess.check_output(tmux + ['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', name, '-x', str(a.width), '-y', str(a.height), '-c', str(cwd), shell], text=True).strip()
subprocess.run(tmux + ['set-option', '-p', '-t', pane, '@ompweb_session', sid], check=True)
subprocess.run(tmux + ['set-option', '-p', '-t', pane, 'remain-on-exit', 'on'], check=True)
subprocess.run(tmux + ['wait-for', '-S', barrier], check=True)
print('Mirroring session ' + sid)
print('Attach locally: ' + shlex.join(tmux + ['attach-session', '-t', name]))
