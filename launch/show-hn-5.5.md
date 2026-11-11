# Show HN for 5.5 (the app)

Not posted. Samyar posts it by hand once 5.5 is released, and answers comments by hand.
Check every number against the repo on the day; nothing below should be a claim the
README can't back.

**Title** (80 characters at most):

> Show HN: OpenLeads, a local Apollo alternative you talk to (plan first, then run)

Alternates:

> Show HN: OpenLeads, find and email leads from your own machine, free and local
> Show HN: I forked T3 Code's UI to build a local sales tool that shows its plan first

**URL:** https://github.com/Samyrrrrrr990/openleads

**First comment** (post it right after submitting):

---

Hi HN. OpenLeads finds people's work emails from public data and runs outreach from
your own machine. No account, no credits, nothing phones home.

What's new is the front door. You type a sentence:

    every weekday at 9am email 20 agencies in Miami about our SEO audit

and it shows a numbered plan (schedule, find, keep deliverable addresses, skip people
you've already emailed, write, queue) and waits. Nothing runs until you press Run, and
nothing sends until you approve each first email. A search streams results as it
finds them. A schedule is saved as a workflow you can open in a node editor.

The page it opens on is Today: who replied, which drafts are waiting for a yes, what's
due. That replaced fifteen sidebar pages with six.

Things that might interest people here:

- The sentence is read by plain rules by default. If you connect a model (your Claude
  or ChatGPT subscription through their CLIs, an API key, or Ollama) it reads the
  request instead, but OpenLeads still builds and checks the plan itself. A model
  can't add a schedule, a sequence or a bigger count than you wrote, and if it reads
  your sentence as more than the rules did, the button changes to "Yes, run it" and
  says why.
- A model sorts replies, but it can only raise one to "needs you". When it thinks a
  reply is a polite no, the reply stays on your list with a label. Hiding an
  interested reply is the expensive mistake.
- The UI is a fork of T3 Code's web app (MIT): their interface primitives and design
  language, with everything about coding agents taken out. The server is still a
  stdlib `ThreadingHTTPServer`, the core still has zero dependencies, and the app is
  built into the wheel, so `pip install openleads` needs no Node.
- The old dashboard had a 1,300 line workflow editor in vanilla JS that works well. I
  didn't rewrite it. The new app shows it in a same-origin frame, and it follows the
  app's theme and hands ⌘K back to the app.

Try it without touching your data:

    pip install openleads
    openleads demo

That opens the app on an invented workspace (`.example` addresses), so you can
approve, skip and ask without emailing anyone.

It's AGPL-3.0, free to use at work, with a commercial license if you want to embed
it in a closed product.

I'd like to hear about requests it reads wrong. Those become test cases.

---

## The 30-second demo (screen recording)

Record at 1440×900, light mode, on `openleads demo`. No narration needed; captions
in the post are enough.

1. (0s) Today is open: three replies, three emails to approve, tasks. Hold one second.
2. (2s) Press `/`. Type: `every weekday at 9am email 20 agencies in Miami about our SEO audit`.
3. (9s) Enter. The plan appears with six steps and "read by the built-in rules".
4. (13s) Press Enter on **Save schedule**. The answer says the workflow is saved.
5. (16s) Click **See the workflow**, then the workflow's name: the node editor opens
   inside the app with the same six steps as nodes.
6. (22s) `g t` back to Today. Click the pencil on the first draft, show the email,
   then **Approve**. (On the demo workspace no mailbox is connected, so it says to
   connect one. Cut before that, or connect a test mailbox.)
7. (28s) `⌘K`, type a name, Enter: the person's panel slides in. End.

## If asked

- **"Is scraping emails legal?"** It only reads what companies publish, and labels
  every address by how it knows it (found, pattern, guessed). You are responsible for
  how you use it; there's an unsubscribe line and a suppression list built in, and
  dry-run is the default.
- **"Why AGPL?"** So a hosted clone has to share its changes. Using it at your
  company is fine.
- **"Why fork T3 Code instead of using shadcn?"** I liked how T3 Code feels: dense,
  keyboard first, a conversation in the middle. Forking kept that feel honest and
  the license (MIT) allows it. The notice ships with every build.
- **"Does the model see my contacts?"** Only if you pick a provider on purpose, and
  only what each job needs. With Ollama nothing leaves the machine; with no model,
  nothing is sent anywhere.
