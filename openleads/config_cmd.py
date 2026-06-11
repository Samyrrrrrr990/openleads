"""
``openleads config`` — manage settings and secrets from inside the CLI.

No more hand-editing dotfiles: list everything, get/set individual keys, or run an
interactive walkthrough grouped by area (AI, discover, sender, mailbox, sending,
web). Secrets are read with a hidden prompt and stored in the 0600 secret file.
"""
from __future__ import annotations

import getpass

from openleads import settings


def _print_all() -> None:
    print("OpenLeads settings  (env > stored > default)\n")
    last_group = None
    for item in settings.all_settings():
        if item["group"] != last_group:
            print(f"\n[{item['group']}]")
            last_group = item["group"]
        val = item["value"]
        shown = f"{val}" if val not in ("", None) else "(unset)"
        src = item["source"]
        flag = " *secret" if item["secret"] else ""
        print(f"  {item['key']:<20} = {shown:<32} ({src}){flag}")
    print("\nSet with:  openleads config set KEY VALUE")


def _prompt_value(item: dict):
    key, typ = item["key"], item["type"]
    current = item["value"]
    cur_disp = current if current not in ("", None) else "unset"
    if item["choices"]:
        cur_disp += f"  choices: {', '.join(item['choices'])}"
    label = f"  {key} [{cur_disp}]: "
    if item["secret"]:
        entered = getpass.getpass(label + "(hidden) ")
    else:
        entered = input(label)
    entered = entered.strip()
    if not entered:
        return None  # keep current
    if typ == "bool":
        entered = entered.lower() in ("1", "true", "yes", "y", "on")
    return entered


def interactive() -> int:
    """Walk through every setting group, keeping blanks unchanged."""
    print("OpenLeads interactive setup — press Enter to keep the current value.\n"
          "(For Gmail/Outlook, use an APP PASSWORD, not your normal password.)\n")
    items = settings.all_settings()
    by_group: dict[str, list] = {}
    for it in items:
        by_group.setdefault(it["group"], []).append(it)
    for group, group_items in by_group.items():
        print(f"\n=== {group} ===")
        for it in group_items:
            try:
                value = _prompt_value(it)
            except (EOFError, KeyboardInterrupt):
                print("\nstopped.")
                return 0
            if value is not None:
                try:
                    settings.set(it["key"], value)
                    print(f"    saved {it['key']}")
                except (ValueError, KeyError) as e:
                    print(f"    [skip] {e}")
    print("\nDone. Run `openleads doctor` to verify your setup.")
    return 0


def main(args) -> int:
    action = getattr(args, "action", None)
    if not action:
        return interactive()
    if action == "list":
        _print_all()
        return 0
    if action == "get":
        if not args.key:
            print("usage: openleads config get KEY")
            return 2
        print(settings.get(args.key))
        return 0
    if action == "set":
        if not args.key or args.value is None:
            print("usage: openleads config set KEY VALUE")
            return 2
        try:
            settings.set(args.key, args.value)
        except (ValueError, KeyError) as e:
            print(f"[!] {e}")
            return 2
        print(f"saved {args.key}")
        return 0
    if action == "unset":
        try:
            settings.unset(args.key)
        except KeyError as e:
            print(f"[!] {e}")
            return 2
        print(f"unset {args.key}")
        return 0
    print(f"unknown config action: {action}")
    return 2
