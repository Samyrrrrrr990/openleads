# Sites

Build a business a better website before you ever talk to them, then send the
owner the link. That's the web-agency loop, and **Sites** in `openleads web` is
where it lives, from the first click to the email.

## Build one for a lead

Open **Sites** and find a business (or click **Build site** on anyone in People).
OpenLeads then:

1. **Picks the template** that fits what they do: a dental practice, a café, an
   electrician, a builder, a gym, a salon, a law or accounting firm, and more,
   with a general local-business template for everything else. The template menu
   in the site's header switches to any other one, keeping their details.
2. **Fills in their details**: business name, phone number, email and city in
   place of the template's made-up ones.
3. **Has your model write the words** for that business, if you've picked one:
   your Claude subscription (the `claude` CLI), a key, or a local model. It
   rewrites headlines, services and the about text, and never invents awards,
   prices, years in business or reviews: those become short placeholders in
   square brackets, such as `[Your opening hours]`, and every testimonial becomes
   `[A customer review goes here]`. It takes about half a minute and carries on
   if you open something else.
4. **Shows you the site** next to a log of what was done.

No model yet? **Use Claude** on the Sites screen switches to your Claude
subscription in one click. Without a model the site keeps the template's words,
with their details swapped in.

## Change anything

Type what you want in the box under the log: "make the headline shorter", "add
a section about opening hours", "warmer colours", "use a serif typeface". The
model turns the request into Studio's editing commands, and every command is
checked against the site before it's applied, so a confused answer can't break
the page. Anything refused is listed with the reason. **Undo** (or `⌘Z`) steps
back one change at a time, Claude's copy pass and template switches included.

Without a model, Studio's built-in rules handle page-wide requests such as "make
it calmer" or "more premium".

For hands-on layout work, **Studio** in the header opens the same site in the
full drag-and-drop editor. Both save to the same place.

## Send it

**Send** writes a short first email offering the site, addressed to the lead:
edit the subject and message, then send. It goes out from your mailbox through
the normal sender, so warm-up limits, unsubscribes and the approval rules all
apply; if today's warm-up allowance is used up, it waits in Today instead.
`{{site_url}}` in the message becomes the site's public link, and the site is
published first if it isn't live yet. A second send to the same person goes as
a follow-up.

## The link

Each site gets a preview at `/s/<slug>/` on your local dashboard, where `<slug>`
comes from the business name (`northwind-dental`). The slug never changes once
the site exists.

`{{site_url}}` works in any template or sequence step too:

```
Hi {{first_name}}, I rebuilt your homepage to show what it could look like:
{{site_url}}
```

The public link is the Netlify address after you publish, or your own host plus
the slug when `site_base_url` is set (for example `https://demos.youragency.com`
gives `https://demos.youragency.com/northwind-dental/`). With neither, Send tells
you before anything goes out, and a template draft lists `site_url` as missing.

## Publish

**Publish** writes the site as a static folder, `sites/<slug>/` in your
OpenLeads folder, that any host can serve. With a Netlify personal access token
in `netlify_token` (or `NETLIFY_AUTH_TOKEN`), it also deploys each site to its own
free Netlify address and remembers it as the site's public link.

| Setting | What it does |
|---|---|
| `site_base_url` | Where you host published sites yourself. `{{site_url}}` becomes this plus the slug. |
| `netlify_token` | Publish deploys to Netlify. Stored like your other keys, never shown back. |

## The API

`GET /api/sites`, `/api/sites/get?id=`, `/api/sites/lead?email=`,
`/api/sites/email?id=` and `POST /api/sites/save`, `/rename`, `/link`, `/delete`,
`/publish`, `/log`, `/send`, `/ai`. `/ai` answers a prompt with the model you
picked and nothing else; `/send` really sends. Same rules as every dashboard
endpoint: loopback only, JSON bodies, cross-site requests refused.

Studio's engines (templates, the command validator, the renderer) are also built
as one module, `/studio/auto.js`, which is what the Sites screen runs.
