# openleads (npm wrapper)

This is a thin Node wrapper that lets you run **[OpenLeads](https://github.com/Samyrrrrrr990/openleads)** — the free, open-source Apollo alternative — via `npx`.

OpenLeads itself is a Python tool. This wrapper finds your Python, installs the
package on first run (`pip install 'openleads[chat]'`), and forwards everything to it.

```bash
# one-off, no install
npx openleads find "50 fintech founders verified only"

# or install the command globally
npm i -g openleads
openleads            # launches the interactive chat
```

Requires **Python 3.8+** and `pip` on your PATH. For the full experience
(`pip install 'openleads[chat]'`) you get the rich interactive chat TUI.

See the main project for full docs: https://github.com/Samyrrrrrr990/openleads
