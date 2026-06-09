"""
Back-compat shim. The outreach companion moved to ``openleads.campaign`` in v2.0.

    python automation.py            # dry-run preview (was the old behavior)
    python automation.py --live     # send

Prefer: ``openleads campaign`` / ``openleads campaign --live``.
"""
import sys

from openleads.campaign import main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
