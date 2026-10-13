# X / Twitter thread

Attach docs/assets/workflows.gif to tweet 6.

1/
I built a free, open-source Apollo/Hunter alternative.

Type "dentists in Austin" → real businesses, the people who work there, and their
emails, each labelled found / pattern / guessed.

No API keys. Runs on your laptop. $0.

github.com/Samyrrrrrr990/openleads

2/
The labels are the point.

Most free email finders call every first.last@ guess "verified". OpenLeads tells you
which addresses were published or server-confirmed, which follow a format it saw
at that company, and which are guesses.

3/
Where it searches:
• OpenStreetMap: local businesses in any city
• YC + Hacker News: founders and companies hiring
• GitHub: developers
• OpenAlex: researchers
• SEC EDGAR + Wikidata: companies
• company team pages: the actual people

4/
My 300 unit tests all passed while the tool returned "Refund Policy" as a person 🙃

So now it runs 12 real searches against the live sources every night and commits the scoreboard: 12/12 return results, 82% fill, 0% junk names.

5/
It's also an MCP server, so Claude / Cursor can use it:

claude mcp add openleads -- openleads mcp

"find 10 law firms in London we can actually email" just works.

6/
And it runs itself:

openleads recipe add miami "agencies in Miami" --every "weekdays 9am" --send
openleads schedule on

It drafts, sends inside a daily cap, follows up, and stops for anyone who replies.

New in 4.6: the local dashboard draws it as an n8n-style canvas. Click a node to edit it, hit Test run, watch it fill in. (GIF)

7/
AGPL-3.0, stdlib-only Python, `pipx install openleads` or `npx openleads`.

Site: samyrrrrrr990.github.io/openleads
A ⭐ helps other people find it → github.com/Samyrrrrrr990/openleads
