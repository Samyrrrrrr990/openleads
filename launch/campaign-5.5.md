# 5.5 launch: Hacker News and Reddit

5.5.0 is on PyPI and npm (2026-11-12). These are drafts. Rewrite each one in your own
words before it goes out: HN asks for human-written posts and comments, and several
subreddits remove posts that read as AI-written.

**Accounts.** Reddit goes out from u/Jumpy_Aerie_9569 through Composio (3 karma,
account from 2022). Low karma is the biggest risk: some subs filter new posters
silently, so check each post is visible from a logged-out browser after it goes up.
Composio can't submit to Hacker News, so the Show HN is posted by hand at
https://news.ycombinator.com/submit.

**Pace.** One subreddit a day. The same link in many subs on one day trips Reddit's
spam filter, and on a 3-karma account that can get the account suspended. Reply to
every comment in the first two hours; that matters more than the post.

| Day | Where | Who posts | Notes |
|---|---|---|---|
| Thu 12 Nov | Show HN | You, by hand | Text in `show-hn-5.5.md`. Stay in the thread. |
| Thu 12 Nov | r/SideProject | Composio | Self-promotion is the point of the sub. |
| Fri 13 Nov | r/selfhosted | Composio | Check its rules first: new-project posts may be limited to certain days, and it needs a flair. |
| Mon 16 Nov | r/Python | Composio | Needs the Showcase flair and their three-part template (used below). |
| Tue 17 Nov | r/ClaudeAI | Composio | Project posts need a flair and to say how Claude was used. |
| Wed 18 Nov | r/coldemail | Composio | Read the rules first; some cold email subs ban tools outright. |

---

## r/SideProject

**Title:** I built a free, local alternative to Apollo: you type who you want, it shows the plan, and nothing sends until you approve

**Body:**

I've been building OpenLeads for a few months: an open-source tool that finds people's
work emails from public sources and runs outreach from your own computer. No account,
no credits, no API keys.

5.5 came out today, and it's the first version I'd call pleasant to use:

- You type a sentence, like "email 15 agencies in Miami about our SEO audit". It shows a
  numbered plan and waits. Nothing runs until you say yes, and no email sends until you
  approve it.
- Every address is labeled found, pattern or guessed, so you know which ones are a
  gamble before they hurt your sender reputation.
- The home page is Today: replies to answer, drafts to approve, tasks due, and how the
  month went.
- Bring your own model (your Claude or ChatGPT subscription, an API key, or Ollama), or
  none at all.

Try it on invented data first:

    pip install openleads
    openleads demo

GitHub: https://github.com/Samyrrrrrr990/openleads
Site: https://samyrrrrrr990.github.io/openleads/

It's AGPL and free. Tell me what it gets wrong.

---

## r/selfhosted

**Title:** OpenLeads 5.5: a self-hosted lead finder and outreach workspace. One SQLite file, no API keys, AGPL

**Body:**

OpenLeads finds people and their work emails from public sources (OpenStreetMap,
company websites, mail servers and others) and gives you a small CRM to work them:
lists, sequences, tasks, deals. Everything runs on your machine.

The self-hosting details:

- Your whole workspace is one SQLite file in `~/.openleads`.
- `openleads web` binds to 127.0.0.1 only. The server is Python's standard library;
  the core has no dependencies.
- It works with no AI model at all. If you want one, Ollama keeps everything on the
  machine; Claude, ChatGPT and API keys are opt-in.
- Mailbox passwords and keys stay in a file only your user can read.
- Scheduled runs use launchd, cron or Task Scheduler, not a cloud worker.

5.5 adds a new web app: a Today page, an Ask box that shows its plan before it runs,
analytics, and a connections page.

    pip install openleads
    openleads demo   # opens on an invented workspace

https://github.com/Samyrrrrrr990/openleads

---

## r/Python (Showcase flair)

**Title:** OpenLeads: a zero-dependency Python tool that finds work emails from public data and says how it knows each one

**Body:**

**What My Project Does**

You describe who you want ("dentists in Austin", "fintech founders") and OpenLeads
searches free public sources for the people, finds their work emails, and labels each
address found, pattern or guessed. It also has a local CRM and an outreach queue where
nothing sends until you approve it.

The parts that might interest this sub:

- The core is standard library only: the HTTP server is `ThreadingHTTPServer`, the MCP
  server is hand-rolled, and DNS lookups go over DNS-over-HTTPS with `urllib`.
- The React app is built into the wheel, so `pip install openleads` needs no Node.
- Scraped "names" are checked against a given-name list, because the first version
  happily returned "Refund Policy" as a person.
- A nightly GitHub Action runs real searches against the live sources and commits the
  results, so the quality numbers are public.

**Target Audience**

Solo founders and small teams who do their own outreach and don't want to pay per
contact. It's used in production by its users, not a toy, but it's one person's
project.

**Comparison**

Apollo, Hunter and Snov are hosted, charge per lead and give you one confidence score.
OpenLeads runs locally, costs nothing, and tells you where each address came from. It
has far less data than Apollo, because it only uses public sources.

    pip install openleads
    openleads demo

https://github.com/Samyrrrrrr990/openleads

---

## r/ClaudeAI (flair for built projects)

**Title:** I built a local lead-finding app that can use your Claude subscription through Claude Code

**Body:**

OpenLeads finds people and work emails from public data and runs outreach from your
own machine. In 5.5 you can point it at the Claude subscription you already pay for:
it finds Claude Code on your computer and offers a one-click "Use Claude". No API key
needed.

What Claude does in it: reads your request ("every weekday at 9, email 10 new gyms in
Denver"), writes drafts from what it found about each person, and sorts replies. What
it can't do: add a schedule, a sequence or a bigger number than you wrote. OpenLeads
builds and checks the plan itself, and nothing sends until you approve.

It also ships an MCP server, so you can work your leads from Claude directly:

    claude mcp add openleads -- openleads mcp

How Claude was used to build it: most of the 5.5 app was written with Claude Code,
including a review loop where separate Claude agents scored the design and listed what
to fix.

https://github.com/Samyrrrrrr990/openleads

---

## r/coldemail

**Title:** Free tool that labels every email found / pattern / guessed before you send, so guesses don't burn your domain

**Body:**

Bounces from guessed addresses are the fastest way to hurt a sending domain, and most
finders hide the guessing behind one confidence number.

OpenLeads labels each address by how it knows it:

- **Found:** published on the company's site, in a public commit, or confirmed by the
  mail server.
- **Pattern:** built from a format already seen at that company.
- **Guessed:** the most common format for that name, and labeled as a guess.

Then seven checks sort them into deliverable (sent by default), risky (held for you)
and will bounce (dropped). It has warm-up caps, a suppression list and one-click
unsubscribe, and nothing sends until you approve the first email.

It's free and runs on your own computer: https://github.com/Samyrrrrrr990/openleads
