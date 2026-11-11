# Your model

OpenLeads works with no model at all: built-in rules read your requests, the
built-in writer drafts emails, and simple phrases sort replies. Connect a model and
it does those jobs better. You can use one you already pay for.

```bash
openleads setup ai
```

lists what this computer has, lets you pick one by number, sends it one tiny test
message, and saves it only if it answers.

## Three ways in

| | Provider | What you need |
|---|---|---|
| Your subscription | `claude` | The [Claude Code](https://claude.com/claude-code) CLI, logged in once (`claude`). |
| | `codex` | The [Codex](https://github.com/openai/codex) CLI, logged in once with your ChatGPT plan. |
| An API key | `anthropic` | `ANTHROPIC_API_KEY` |
| | `openai` | `OPENAI_API_KEY` |
| | `gemini` | `GEMINI_API_KEY` (Google AI Studio has a free tier) |
| Free or local | `openrouter` | `OPENROUTER_API_KEY`; free models need no credit |
| | `ollama` | Ollama running on this computer, with a model pulled |
| | `custom` | Any OpenAI-compatible endpoint: `ai_base_url`, plus `ai_api_key` if it needs one |

Without a terminal (a script, CI, a Dockerfile):

```bash
openleads setup ai --use claude                # test it, then save it
openleads setup ai --use anthropic --model claude-haiku-5-5
openleads setup ai --use off                   # rules only
```

### Which model

There are two settings, so switching provider never sends one provider's model name
to another:

- `ai_provider_model` is the model for a subscription or a key (`claude`, `codex`,
  `anthropic`, `openai`, `gemini`). `--model` sets it, and switching provider clears
  it. The defaults are `sonnet` for the Claude CLI, the CLI's own default for Codex,
  `claude-sonnet-5-5`, `gpt-4.1-mini` and `gemini-2.5-flash`.
- `ai_model` is the model for OpenRouter, Ollama or your own endpoint, as in
  earlier versions. The defaults are a free OpenRouter model and the first model
  Ollama lists.

### Nothing is spent without a yes

A subscription or a paid key is used only after you pick it with `openleads setup
ai`, in Settings, or by setting `ai_provider` yourself. The default (`auto`) only
uses what older versions already used: an OpenRouter key or an `ai_base_url`, and
in `auto` that model only reads requests and writes drafts, the same jobs it had
before. Sorting replies and answering questions send other people's words and your
workspace, so they wait until you choose a provider on purpose.

If a Claude or Codex CLI is installed and you haven't chosen anything, Today
mentions it in its heads-ups each time you open it. It never switches for you.

### How the CLIs run

OpenLeads runs each CLI in an empty scratch folder and keeps no session. Your API
keys are taken out of its environment, so a subscription CLI bills your
subscription and never a key you happen to have set.

- Claude runs with every tool off and nothing loaded from your own setup:
  `claude -p --tools "" --strict-mcp-config --setting-sources project`, plus
  `--disable-slash-commands` and `--no-session-persistence`. It can only answer
  with text.
- Codex runs in its read-only sandbox (`codex exec -s read-only --ephemeral`) with
  plugins and apps off. A read-only sandbox can still read files, so Codex is never
  given a reply someone sent you or your workspace summary. It reads requests and
  writes drafts; for sorting replies and questions, OpenLeads uses the rules.

## What the model does

**Reads your request.** `openleads "..."` and chat send your sentence to the model,
which says what you want (search, email once, on a schedule, or add to a sequence),
who, how many and what about. OpenLeads checks every field and builds the plan
itself, so the model never decides whether anything goes out live. The plan says who
read it:

```text
$ openleads "each workday at half past eight hit up fifteen Austin dentists about appointment reminders"
Plan  (read by claude:sonnet)
  1. Schedule  every weekday at 08:30
  2. Find      up to 15 dentists in Austin
  3. Keep      only deliverable (safe) emails
  4. Skip      anyone you've already emailed
  5. Write     an email about appointment reminders
  6. Then      the emails go into your approval queue (openleads today)
```

The model can't turn a request into more than you said. A schedule needs a time or
a word like "every" or "daily" in your sentence, a sequence needs the word
"sequence", and the count is capped at the number you wrote (100 if you wrote
none). When the model reads your sentence as something bigger than the rules do
(say, an email where the rules saw a search), the plan asks for a yes in the
terminal before it runs, and from a script it doesn't run at all.

If the model is slow (over a minute), offline, or answers something that doesn't
check out, the rules read the request instead and the plan says `rules`.

**Writes drafts.** Same rules as before: the model gets only the facts OpenLeads
found, and a draft that mentions anything else is thrown away for the built-in
writer's. See [Writing emails](writing.md).

**Sorts replies.** Bounces, out-of-office and unsubscribe requests are still decided
by rules (an unsubscribe suppresses the address, and a model never does that). The
model reads the rest. It can flag a reply the rules missed as one that needs you,
but it never hides one: when the rules think a reply needs you and the model thinks
it's a polite no ("we built this in house last year"), the reply stays on Today
with a **looks like a no** label, so you decide. For replies that need you, Today
shows a suggested answer you can start from. It won't invent prices or facts; it
says "I'll check" instead. One inbox scan asks the model about ten replies at most;
the rest are sorted by the rules.

**Reads your morning.** When something is waiting, Today opens with one or two
sentences on what matters most and what to do first ("Maya at Northwind asked for
pricing yesterday; answer her before the three approvals"). It's asked once and
kept until your replies, approvals or tasks change, and it needs a provider you
chose, like reply sorting.

**Answers questions about your workspace.** Ask `openleads "who replied and what do
they want?"` or "how many contacts are in each stage?" (in chat too). A sentence is
treated as a question when it reads like one ("who", "how many", "what", or a
question mark) and is about your own data ("I", "my", "we", replies, contacts,
stages, deals, sequences, this week). "Who are the fintech founders in London?" is
about nobody's data yet, so it runs the search instead.

For a question, OpenLeads sends the model a small summary: what Today shows, counts
by stage and status, sends and replies from the last week, sequences, open deals and
your 40 most recent contacts. The model answers only from that and says so when it
can't tell.

### What leaves your computer

Only what each job needs goes to the provider you picked: the request, the facts
about the person you're writing to, the reply being sorted, or the workspace
summary for a question. With Ollama nothing leaves your computer. With no model,
nothing is sent anywhere.

## In the dashboard

Settings, AI model shows what's connected and what this computer has. **Use this**
tests a provider first and switches only if it answers; **Test it** checks the one
you have. The Today page shows suggested answers under each reply.

## Cost and speed

Each request, draft or reply is one short call. The API keys usually answer in a
few seconds. A CLI starts a fresh process every time, so it's slower and can take
up to a minute for a request or a reply and a minute and a half for a draft before
OpenLeads gives up and uses the rules. Writing 200 drafts at once with a
subscription takes a while, so for big batches an API key or a free OpenRouter
model is the better pick.
