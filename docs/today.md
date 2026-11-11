# Today: what needs you

`openleads today` answers one question: what should I do now? It shows, in this order:

1. **Replies** waiting on you, oldest first, with the first lines of what they wrote.
2. **Emails to approve**: first emails from sequences and scheduled workflows that wait
   for your yes before they go.
3. **Tasks** due today or overdue (calls, LinkedIn, manual emails).
4. **New leads** found since you last looked.
5. **Heads-ups**: mailbox not connected, today's sending limit reached, bounces above
   5% of last week's sends, a workflow that failed, emails your pre-send hook held.

Empty sections are skipped. The same briefing is the dashboard's home page, the
`today` MCP tool, and a line at the top of `openleads` chat.

## In the terminal

This is the demo workspace (`openleads demo`, invented people):

```text
$ openleads today
Today

Replies (3)
  Daniel Reyes <daniel@northwind-dental.example> · Northwind Dental  6d ago
    "Interesting timing, we were just talking about this. Free Thursday afternoon for a call?"
  Elena Marsh <elena@brightside.example> · Brightside Marketing  5d ago
    "Who else in our space uses this? Happy to look if it's a fit."
  Maya Okafor <maya.okafor@northwind-dental.example> · Northwind Dental  5d ago
    "Thanks for reaching out. Can you send pricing for a team of five?"

Emails to approve (3)
  #1 to rachel@atlasfreight.example  "question about Atlas Freight"  quality 91
  #2 to tbrennan@atlasfreight.example  "question about Atlas Freight"  quality 91
  #3 to aisha.rahman@atlasfreight.example  "question about Atlas Freight"  quality 91

Tasks (4)
  Call Maya about the case study  (maya.okafor@northwind-dental.example)  2d overdue
  Call Victor re: freight volumes  (victor.petrov@atlasfreight.example)  1d overdue
  Send pricing deck to Lucas  (lucas@heliopay.example)  today 09:00
  Connect with Grace on LinkedIn  (gliu@heliopay.example)  today 09:00

Heads-up
  ! Mailbox not connected: nothing can send. Run `openleads setup`.
  · Replies aren't being read. Add IMAP in `openleads setup` to see them here.

3 replies, 3 emails to approve, 4 tasks. Nothing else needs you.
```

On a real terminal it then walks you through each item with one key:

| Item | Keys |
|---|---|
| Reply | `d` done, `z` snooze to tomorrow 9:00, `n` next, `q` quit |
| Email to approve | `a` approve (sends now), `e` edit in `$EDITOR` then send, `s` skip, `n` next, `q` quit |
| Task | `d` done, `z` snooze to tomorrow 9:00, `n` next, `q` quit |

Piped into another program, or with `--no-input`, it only prints. `--json` prints the
whole briefing as JSON.

## The approval queue

Unattended sends wait for a yes in new workspaces: a sequence's first email, a
scheduled workflow's Send, and a campaign you start with `openleads "..."` without
`--live`. Approving sends through the normal sender, so suppression, the warmup cap
and your pre-send hook still apply. A draft for someone who replied, bounced or left
the sequence since it was queued is skipped instead of sent.

```bash
openleads config set approve_first_emails off   # send unattended first emails directly
openleads config set approve_first_emails on    # always wait for approval
```

The default (`auto`) is on for workspaces created with 5.3 and off for workspaces that
were already sending, so an upgrade never pauses a running campaign.

## Replies

When IMAP is set up, `openleads inbox` (and every scheduled run) keeps each reply on
the contact's timeline and sorts it: needs you, not interested, unsubscribe, out of
office, or bounce. Only "needs you" shows in Today. An unsubscribe request suppresses
the address. A reply stops waiting once you've answered it (OpenLeads sees your reply
in the Sent folder, or a later email to that person), marked it done, or snoozed it.

## From an assistant

The MCP server has `today`, `approve_draft`, `skip_draft`, `snooze` and
`mark_reply_done`, so Claude or Cursor can run the morning with you. `approve_draft`
really sends; a good assistant asks you first. See [MCP](mcp.md).
