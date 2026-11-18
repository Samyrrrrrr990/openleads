# Sites

Build a business a better website before you ever talk to them, then send the
owner a link to it. That's the web-agency loop, and Sites is where it lives.

**Sites** in `openleads web` lists the demo sites you've built. **Build for a
lead** picks someone from People and opens **Studio**, the drag-and-drop site
builder, with their business already filled in: name, city, phone, what they do.
Pick one of the templates, change anything on the canvas, and it saves as you go.

Studio runs on your machine, inside OpenLeads, with nothing to buy: every
template, every feature, unlimited undo history.

## The link

Each site gets a preview at `/s/<slug>/` on your local dashboard, where `<slug>`
comes from the business name (`northwind-dental`). The slug never changes once
the site exists.

`{{site_url}}` in a template or sequence step becomes the public link to the site
you built for that person:

```
Hi {{first_name}}, I rebuilt your homepage to show what it could look like:
{{site_url}}
```

The public link is the Netlify address after you publish, or your own host plus
the slug when `site_base_url` is set (for example `https://demos.youragency.com`
gives `https://demos.youragency.com/northwind-dental/`). With neither, or for a
lead with no site, the draft lists `site_url` as missing so you can see it before you approve.

## Publish

**Publish** in Studio writes the site as a static folder, `sites/<slug>/` in your
OpenLeads folder, that any host can serve. With a Netlify personal access token
in `netlify_token` (or `NETLIFY_AUTH_TOKEN`), it also deploys each site to its own
free Netlify address and remembers it as the site's public link.

| Setting | What it does |
|---|---|
| `site_base_url` | Where you host published sites yourself. `{{site_url}}` becomes this plus the slug. |
| `netlify_token` | Publish deploys to Netlify. Stored like your other keys, never shown back. |

## The API

`GET /api/sites`, `/api/sites/get?id=`, `/api/sites/lead?email=` and
`POST /api/sites/save`, `/rename`, `/link`, `/delete`, `/publish`. Same rules as
every dashboard endpoint: loopback only, JSON bodies, cross-site requests refused.
