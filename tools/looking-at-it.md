# Looking at the thing

The Browser pane will not take screenshots in this environment, so a visual
change gets checked like this instead — the point being that it gets LOOKED
at, not measured. Numbers will happily confirm that a label has contrast
somewhere inside a button while the label itself is illegible; that mistake
has already been made once here.

1. In the page, draw whatever needs looking at into a canvas and return
   `canvas.toDataURL('image/jpeg', 0.72).split(',')[1]`.

2. The result is too large for a tool response, so it gets written to a file
   under the session's `tool-results/` directory automatically. That is the
   useful part, not a nuisance: the base64 never passes through anyone's
   context on the way.

3. Decode the newest one and open it:

       python - <<'PY'
       import json, base64, os, glob
       d = r"<...>/.claude/projects/<session>/tool-results"
       f = max(glob.glob(os.path.join(d, "mcp-Claude_Browser-javascript_tool-*.txt")),
               key=os.path.getmtime)
       b64 = json.load(open(f, encoding='utf-8'))[0]['text'].strip().strip('"')
       open('shot.jpg', 'wb').write(base64.b64decode(b64))
       PY

Measurements are still worth taking — they catch what the eye slides over,
like a key light coming from underneath. But they are the second check, and
never the only one.
