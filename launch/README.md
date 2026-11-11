# Launch kit (v4.5)

Everything needed to launch OpenLeads publicly. Nothing here is posted automatically:
each post goes out from your own accounts, and you edit it first.

## Status (2026-11-11)

Numbers today: 65 stars, 15 forks, 246 PyPI downloads in the last week (pypistats.org). Goal before charging: 1,000
stars. 5.3 ("Simple": `openleads "..."`, Today, ten commands) is built on branch
`plan/5.3-5.5`, waiting for your OK to merge and release.

Waiting on you:
- [ ] Say go for the 5.3.0 release (merge, tag, push; the release workflow does PyPI,
      GitHub Releases and the MCP Registry).
- [ ] npm is still on 5.0.0: `gh secret set NPM_TOKEN` with a fresh automation token.
- [ ] Ship notes: add `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `X_API_KEY`,
      `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` and `DEVTO_API_KEY` as repo
      secrets. Until then `ship-notes.yml` only does dry runs.
- [ ] Today's paste queue: `queue/2026-11-11.md` (r/coldemail, LinkedIn, X).
- [ ] Five license replies are drafted in `~/Desktop/email people/openleads-license-replies.md`.

## Status (2026-10-13)

Done:
- [x] v4.6.1 on PyPI and GitHub Releases, with the Workflows canvas and release notes.
- [x] README hero GIF (`docs/assets/workflows.gif`), website and docs links.
- [x] New site and docs live at https://samyrrrrrr990.github.io/openleads/
- [x] Repo homepage, description, and topics updated. Discussions on, with an
      announcement (#12) and a "show us what you found" thread (#13).
- [x] Listed in the official MCP Registry as `io.github.Samyrrrrrr990/openleads`
      (republished automatically after every release by `mcp-registry.yml`).
- [x] List PRs: punkpeye/awesome-mcp-servers#16344, jivoi/awesome-osint#1296,
      dariubs/awesome-lead-generation#34, diegoleme/awesome-open-source-alternatives#57.
- [x] Show HN submitted (item 50075263). It was auto-flagged because the account
      is new; the moderator email was sent to hn@ycombinator.com.
- [x] dev.to article published (marked AI-generated in dev.to's disclosure):
      https://dev.to/samyrrrrrr990/my-300-unit-tests-passed-while-my-lead-finder-returned-refund-policy-as-a-person-35b
- [x] Six starter issues (#14 to #19) labeled good first issue / help wanted.
- [x] Social preview set to site/og.png. Dependabot #1, #2, #8, #9 superseded by e1be7de.

Waiting on you:
- [ ] If HN restores the post, stay in the thread and answer comments yourself
      (HN asks for human replies).
- [ ] npm: set a fresh automation token (`gh secret set NPM_TOKEN`), or publish
      4.6.1 by hand from `npm/` (2FA needs your browser).
- [ ] Dependabot #10 (upload-artifact v7 in release.yml): bump download-artifact to
      match before merging.
- [ ] X thread (`x-thread.md`, attach `docs/assets/workflows.gif` to tweet 6).
- [ ] Hashnode / Medium: cross-post `article.md` with the dev.to URL as canonical.
- [ ] After 50 stars: OpenAlternative (also wants a custom domain, not github.io).
- [ ] Optional, paid: mcp.so listing ($39).
- [ ] Reddit, one sub per day (`reddit.md`). Read each sub's rules first.
- [ ] Product Hunt (`product-hunt.md`).
- [ ] awesome-selfhosted: they only accept human submissions, and the AGPL release
      is from 2026-10-07, so submit after 2027-02-07.

## 5.0 release (the workspace)

Releasing:
- [ ] Merge the 5.0 PR into `main` once CI is green.
- [ ] Tag it: `git tag v5.2.0 && git push origin v5.2.0` — or, without git, run
      **Actions → Tag release → Run workflow** on `main`, which tags the version in
      `pyproject.toml` and starts the Release workflow for it. The release workflow checks
      that the tag, `pyproject.toml`, `openleads/__init__.py` and `npm/package.json`
      agree, builds and checks the wheel (dashboard included), and creates the GitHub
      Release.
- [ ] PyPI publishes from that workflow if Trusted Publishing is on (repo variable
      `PYPI_TRUSTED_PUBLISHING=true`) or a `PYPI_API_TOKEN` secret is set.
- [ ] npm publishes from it if an `NPM_TOKEN` secret is set; otherwise
      `cd npm && npm publish --access public` by hand (2FA in the browser).
- [ ] `mcp-registry.yml` republishes `server.json` (now 5.2.0) after the release.

Announcing (each in its own words, as above):
- [ ] Discussions: a 5.0 announcement — the workspace, `openleads demo`, the Apollo
      comparison, and the four new dashboard screenshots in `docs/assets/`.
- [ ] Reply on the Show HN / dev.to threads only if people ask what changed.
- [ ] Re-record `demo.tape` against `openleads demo` for a dashboard GIF.
- [ ] The "Moving from Apollo" guide (`docs/from-apollo.md`) is the natural link
      for r/sales-style communities; read each sub's rules first.

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
