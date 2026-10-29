"""End to end through the real engine, on the offline FakeNet (no live network)."""
import fakenet
import pytest

import openleads


@pytest.fixture()
def net(monkeypatch):
    n = fakenet.install(monkeypatch)
    n.add(r"overpass-api\.de", fakenet.OVERPASS_REMARK_TIMEOUT)      # main instance overloaded
    n.add(r"overpass\.private\.coffee", fakenet.OVERPASS_OK)         # mirror answers
    n.add(r"type=MX", fakenet.doh_mx())
    n.add(r"type=TXT", fakenet.DOH_TXT_SPF_DMARC)
    n.add(r"gravatar\.com", fakenet.status(404))
    n.add(r"\.example(/|$)", fakenet.business_site)
    return n


def test_dentists_in_austin_end_to_end(net):
    res = openleads.find("dentists in Austin", count=3, budget=0, use_cache=False)
    assert len(res) == 3
    assert {ld.organization for ld in res} == {"Congress Avenue Dental", "Hyde Park Smiles",
                                               "South Lamar Family Dentistry"}
    assert res[0].organization == "Hyde Park Smiles"       # published email ranked first
    assert all(ld.tier == "safe" and ld.evidence == "found" for ld in res)
    assert all(ld.city == "Austin" and ld.contact_type == "company" for ld in res)
    local = res.report.sources["local"]
    assert local.status == "degraded"                      # main Overpass rejected
    assert local.errors[0].startswith("overpass-api.de: rejected: overpass remark")
    assert "gazetteer" in local.note
    assert net.hits("nominatim") == []                     # Austin placed offline
    assert res.report.stop_reason == "count_reached"


def test_dns_servfail_keeps_leads_as_risky(monkeypatch):
    n = fakenet.install(monkeypatch)
    n.add(r"overpass-api\.de", fakenet.OVERPASS_OK)
    n.add(r"type=MX", fakenet.DOH_SERVFAIL)
    n.add(r"\.example(/|$)", fakenet.status(404))
    res = openleads.find("dentists in Austin", count=3, budget=0, use_cache=False,
                         people=False, company_profile=False)
    # Hyde Park Smiles publishes an address; the others can't be formed without a
    # name. A SERVFAIL is "couldn't check", so the published one is kept as risky.
    assert [ld.email for ld in res] == ["hello@hydeparksmiles.example"]
    assert res[0].tier == "risky"
    assert any("couldn't check the mail server" in r for r in res[0].reasons)
    assert any("DNS status 2" in e for e in res.report.errors)
    assert any("DNS lookups failed" in h for h in res.report.hints())


def test_unknown_town_is_geocoded_by_nominatim(net):
    net.add(r"nominatim\.openstreetmap\.org/search\?q=Pflugerville",
            fakenet.NOMINATIM_PFLUGERVILLE)
    res = openleads.find("dentists in Pflugerville, TX", count=2, budget=0, use_cache=False)
    assert len(res) == 2
    assert len(net.hits(r"nominatim.*Pflugerville")) == 1
    overpass = net.hits(r"overpass\.private\.coffee")[0]
    assert "30.392" in overpass                            # the Nominatim box, clamped


def test_doctor_probes_every_source_endpoint(monkeypatch, capsys):
    from openleads import doctor
    n = fakenet.install(monkeypatch)
    n.add(r"overpass-api\.de/api/status", "Connected as: 1\n2 slots available now.")
    n.add(r"nominatim", '{"status": 0, "message": "OK"}')
    n.add(r"api\.github\.com", fakenet.status(403))
    n.add(r".", "{}")
    results = doctor.probe_sources(timeout=1)
    by_name = {r["name"]: r for r in results}
    assert by_name["Overpass (overpass-api.de)"]["status"] == "ok"
    assert by_name["GitHub API"]["status"] == "bad"
    assert "HTTP 403" in by_name["GitHub API"]["detail"]
    assert {r["source"] for r in results} >= {"local", "companies", "github", "hn", "yc",
                                              "email"}
    assert len(n.calls) == len(results)                     # one request per probe
    doctor.print_source_probes(results)
    out = capsys.readouterr().out
    assert "Sources (live probes)" in out and "proxy or firewall" in out
