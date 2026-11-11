# Your model

OpenLeads works with no model at all: built-in rules read your requests, the
built-in writer drafts emails, and simple phrases sort replies. Connect a model and
it does those three jobs better. You can use one you already pay for.

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

`ai_model` picks the model. The defaults are `sonnet` for the Claude CLI, the CLI's
own default for Codex, `claude-sonnet-5-5`, `gpt-4.1-mini` and `gemini-2.5-flash`
for the API keys, a free model on OpenRouter, and the first model Ollama lists.

### Nothing is spent without a yes

A subscription or a paid key is used only after you pick it with `openleads setup
ai`, in Settings, or by setting `ai_provider` yourself. The default (`auto`) only
uses what older versions already used: an OpenRouter key or an `ai_base_url`. If a
Claude or Codex CLI is installed and you haven't chosen anything, Today says so once
in its heads-ups; it never switches for you.

Through a CLI, OpenLeads runs it in an empty scratch folder and keeps no session.
Claude runs with every tool turned off (`claude -p --tools ""`), so it can only
answer with text. Codex runs in its read-only sandbox (`codex exec -s read-only
--ephemeral`) with plugins and apps off, so it can't change anything.

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

If the model is slow, offline, or answers something that doesn't check out, the
rules read the request instead and the plan says `rules`.

**Writes drafts.** Same rules as before: the model gets only the facts OpenLeads
found, and a draft that mentions anything else is thrown away for the built-in
writer's. See [Writing emails](writing.md).

**Sorts replies.** Bounces, out-of-office and unsubscribe requests are still decided
by rules (an unsubscribe suppresses the address, and a model never does that). The
model decides the rest: does this reply need you, or is it a polite no ("we built
this in house last year")? For the ones that need you, Today shows a suggested
answer you can start from. It won't invent prices or facts; it says "I'll check"
instead.

## In the dashboard

Settings, AI model shows what's connected, what this computer has (with a **Use
this** button), and **Test it**. The Today page shows suggested answers under each
reply.

## Cost and speed

Each request, draft or reply is one short call. Through a CLI that's about five
seconds each; the API keys are faster. Writing 200 drafts at once with a
subscription takes a while, so for big batches an API key or a free OpenRouter
model is the better pick.
