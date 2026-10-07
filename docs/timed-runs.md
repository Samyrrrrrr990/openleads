# Timed runs

Save a search once and let your machine run it on a schedule: find new leads,
draft emails, send them inside your daily cap, export the results, and send
follow-ups. Nothing runs in the cloud.

## 1. Give a recipe a schedule

```bash
openleads recipe add miami "marketing agencies in Miami" --every "weekdays 9am" --send
openleads recipe add devs  "rust developers in Berlin"   --every "every 6h" --export csv --target devs.csv
openleads recipe add weekly "fintech founders" -n 50     --every "mon 08:30"
```

`--every` understands plain English and cron:

| You write | It runs |
|---|---|
| `daily 09:00` · `9am` · `every day at 9:30pm` | once a day |
| `weekdays 8:30` · `weekends 10am` | Mon–Fri / Sat–Sun |
| `mon,wed,fri 14:00` · `tuesdays 7pm` | on those days |
| `hourly` · `every 2h` · `every 30m` · `every 90 minutes` | on an interval |
| `0 9 * * 1-5` | standard 5-field cron |

`openleads recipe list` shows each recipe's schedule. A bad schedule is rejected
when you save it, not when it should have run.

Watchers ("tell me when new leads match") take the same flag. Without one they
run once a day at 09:00:

```bash
openleads watch add new-clinics "dentists in Austin" --every "every 12h" --sink webhook
```

## 2. Arm this machine once

```bash
openleads schedule on        # install the agent
openleads schedule status    # is it installed, and when does each recipe run next?
openleads schedule off       # remove it
```

`schedule on` installs one small agent that wakes every 15 minutes and runs
`openleads drip --live`. Each wake-up runs whatever is due, so one agent serves
every schedule. It uses what your OS already has:

| OS | Mechanism |
|---|---|
| macOS | a launchd agent in `~/Library/LaunchAgents/dev.openleads.drip.plist` |
| Linux | one crontab line, marked `# OpenLeads drip heartbeat` |
| Windows | a Task Scheduler task named `OpenLeads Drip` |

Change the wake-up interval with `--every-minutes 5`. The old fixed daily mode
(`openleads schedule 09:00`) still works.

If the machine is asleep or off when a run was due, the run happens at the next
wake-up. It runs once, even if several slots were missed.

## 3. See what happened

```bash
openleads runs          # the last 20 runs
openleads runs -n 100
```

```text
  ✓ 2026-10-07T09:00:12  recipe     miami             41.2s  found 18 · sent 12
  ✗ 2026-10-07T09:00:54  watcher    new-clinics        3.1s  URLError: network unreachable
  ✓ 2026-10-07T09:15:03  follow-ups default            0.4s  due 0 · sent 0
```

History lives in `~/.openleads/runs.jsonl`. When a run fails, the other jobs
still run and you get told about it:

- a desktop notification on macOS and Linux, and
- a JSON `POST` to `notify_webhook`, if you set one. Slack, Discord, ntfy and
  Zapier webhooks all accept it:

```bash
openleads config set notify_webhook https://hooks.slack.com/services/…
```

## Run it in GitHub Actions instead

If you'd rather not keep a laptop awake, the OpenLeads GitHub Action runs a
search on GitHub's schedule and attaches the CSV to the run:

```yaml
on:
  schedule: [{ cron: "0 13 * * 1" }]
jobs:
  leads:
    runs-on: ubuntu-latest
    steps:
      - uses: Samyrrrrrr990/openleads@v4.5.0
        id: leads
        with: { query: "marketing agencies in Miami", count: 50 }
      - uses: actions/upload-artifact@v4
        with: { name: leads, path: "${{ steps.leads.outputs.file }}" }
```

See [`examples/github-action/weekly-leads.yml`](../examples/github-action/weekly-leads.yml).
Sending from CI isn't supported; the action finds leads.

## Safety

- Recipes that **send**, and follow-ups, only go out inside the send window:
  weekdays, 08:00–11:00 and 13:00–16:00 local time. A sending recipe due at 7pm
  waits and runs at the next wake-up inside the window. Recipes that only find
  or export run at their exact time.
- `openleads drip` without `--live` is a dry run and doesn't use up a slot.
- Sends always respect the daily cap, warmup ramp, send-time windows and
  suppression list from [Sending](sending.md).
- Anyone who replies or bounces is dropped from follow-ups.
