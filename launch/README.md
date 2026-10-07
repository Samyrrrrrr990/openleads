# Launch kit (v4.5)

Everything needed to launch OpenLeads publicly. Nothing here is posted automatically:
each post goes out from your own accounts, and you edit it first.

## Before launch (blocking)

- [ ] Tag and publish v4.5.0 (`git tag v4.5.0 && git push origin v4.5.0`). Check PyPI,
      npm and the GitHub Release all show 4.5.0.
- [ ] `pipx install openleads && openleads find "dentists in Austin"` on a clean machine.
- [ ] Record the GIF: `vhs launch/demo.tape`. Put it at the top of the README, replacing
      the text example.
- [ ] Run the **Live benchmark** workflow once by hand so BENCHMARK.md is current.
- [ ] Repo settings: description, website (the GitHub Pages site), and topics:
      `lead-generation email-finder apollo-alternative hunter-alternative mcp-server
      cold-email openstreetmap osint python cli`.
- [ ] Social preview image: Settings → Social preview → `site/og.svg` exported to PNG.
- [ ] Turn on Discussions and pin a "Show us what you found" thread.
- [ ] Close or merge the 5 open Dependabot PRs so the repo looks maintained.

## Launch order

1. **Tuesday–Thursday, 8–10am US Eastern:** Show HN (`show-hn.md`). Stay in the
   thread for 3 hours and answer every comment.
2. **Same day, 2h later:** X/Twitter thread (`x-thread.md`) and LinkedIn.
3. **Next day:** one Reddit post per day, not all at once (`reddit.md`).
4. **Same week:** submit to the lists in `lists.md`.
5. **Week after:** Product Hunt (`product-hunt.md`) once there's a GIF and some stars.

## What not to do

- Don't buy stars, use star-for-star exchanges, or ask people to upvote the HN
  post. GitHub's terms ban fake stars and HN penalises voting rings; either one can
  sink the launch.
- Don't post the same text everywhere. Each community gets its own angle below.
- Don't over-claim. The benchmark numbers are the pitch, and commenters will check them.
