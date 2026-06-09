# Writing a source plugin

A **source** is the only thing standing between OpenLeads and a new vertical.
Everything downstream — email finding, SMTP verification, scoring, caching,
CSV/JSON/NDJSON output, the chat CLI — is already done. You just teach OpenLeads
how to *discover people* from some free, public dataset.

This is the highest-leverage contribution you can make: one small file turns
OpenLeads into "Apollo for `<your vertical>`".

## The contract

A source is a subclass of `openleads.sources.base.Source` that yields normalized
`Entity` records:

```python
from typing import Iterator
from openleads.sources.base import Source
from openleads.models import Entity, Query


class Source:
    name: str        # registry key, lowercase, e.g. "lawyers"
    kind: str        # "company" | "people"
    vertical: str    # human label, e.g. "attorneys"
    description: str  # one line shown by `openleads sources`

    def search(self, query: Query) -> Iterator[Entity]: ...
```

### The `Entity` you yield

```python
Entity(
    full_name="Ada Lovelace",     # required for person email-finding
    title="Partner",
    organization="Acme LLP",
    domain="acme.law",            # email domain if known/derivable ("" = none)
    website="https://acme.law",
    location="San Francisco, USA",
    links={"linkedin": "...", "bar_id": "..."},  # any profile URLs/ids
    extra={"industry": "Law", "city": "SF", "country": "USA",
           "vertical": "attorneys"},             # surfaced in output
    source=self.name,
)
```

- **If you set `domain`**, the engine finds and verifies an email automatically.
- **If you don't** (many public registries have no email/website), the engine
  still emits the record — the public data itself is valuable. Confidence is
  honestly labeled `none`. NPI (doctors) works exactly this way.

### The `Query` you receive

`Query` carries what the user asked for. Use what's relevant to your dataset:

| field | meaning |
|-------|---------|
| `count` | how many leads the user wants (cap your fetch around this) |
| `keyword` / `industry` | free-text topic/specialty (e.g. "fintech", "pediatric") |
| `location` | place filter |
| `title` | role filter |
| `verified_only` | the engine applies this for you — you can ignore it |
| `max_companies` | scan budget (for sources that page through many entities) |

## Two ways to add one

### 1. A user plugin (no reinstall) — fastest

Drop a `*.py` file into `~/.openleads/sources/`. It's auto-discovered on the next
run. Great for private/company-specific sources you don't want to publish.

```python
# ~/.openleads/sources/crm_export.py
import csv
from openleads.sources.base import Source
from openleads.models import Entity, Query

class CRMExportSource(Source):
    name = "crm"
    kind = "people"
    vertical = "my CRM export"
    description = "Reads contacts from ~/contacts.csv and verifies their emails."

    def search(self, query: Query):
        with open("/Users/me/contacts.csv", newline="") as f:
            for i, row in enumerate(csv.DictReader(f)):
                if i >= query.count:
                    break
                yield Entity(full_name=row["name"], organization=row["company"],
                             domain=row["domain"], source=self.name)
```

```bash
openleads sources            # 'crm' now appears
openleads find --source crm --count 50 --verified-only
```

### 2. A built-in source — contribute it back

Add a module under `openleads/sources/` (e.g. `lawyers.py`), implement the class,
add a fixture-based parse test under `tests/`, and open a PR. The registry finds
any `Source` subclass defined in the package automatically.

## HTTP, caching, and politeness

Use the shared helpers so you get caching and a sane User-Agent for free:

```python
from openleads._http import get_json, get_text

def search(self, query):
    data = get_json("https://api.example.com/people?q=...",
                    cache=self.cache, ttl_ns="dataset")   # cached ~1 day
    ...
```

- `self.cache` is injected by the engine before `search()` runs (may be `None`
  when caching is disabled). Pass it straight through to `get_json`/`get_text`.
- **Be polite:** prefer keyless public APIs, respect rate limits, add small
  delays when paging, and degrade gracefully (return fewer/no results, never
  crash) when a service is down or its shape changes.
- **Stay keyless.** OpenLeads' promise is "no API keys." If a source *can* use an
  optional token for higher limits (like GitHub's `GITHUB_TOKEN`), make it
  optional — keyless must still work.

## Testing your parser

Keep the network-touching part thin and the parsing pure, then test the parser
with a saved fixture (no network):

```python
def test_my_source_parse():
    sample = {"results": [{"name": "Ada", "firm": "Acme", "domain": "acme.law"}]}
    ents = MySource()._parse(sample)   # a pure helper you wrote
    assert ents[0].domain == "acme.law"
```

That's it. Ship a vertical in ~30 lines.
