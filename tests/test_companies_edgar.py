"""Tests for the Wikidata `companies` source and the SEC `edgar` source (pure)."""
from openleads.sources import companies, edgar


# --- Wikidata companies ------------------------------------------------------ #
def test_build_sparql_with_and_without_country():
    s1 = companies.build_sparql("Q1", None, 25)
    assert "wd:Q1" in s1 and "wdt:P856" in s1 and "LIMIT 25" in s1
    assert "wdt:P17 wd:" not in s1  # no hard country filter
    s2 = companies.build_sparql("Q1", "Q183", 10)
    assert "wdt:P17 wd:Q183" in s2


def test_parse_bindings():
    doc = {"results": {"bindings": [
        {"company": {"value": "http://www.wikidata.org/entity/Q42"},
         "companyLabel": {"value": "Acme Corp"},
         "website": {"value": "https://acme.com"},
         "countryLabel": {"value": "United States"}},
        {"company": {"value": "http://www.wikidata.org/entity/Q7"},
         "companyLabel": {"value": "Q7"},  # unlabelled item → skipped
         "website": {"value": "https://other.com"}},
        {"companyLabel": {"value": "No Site"}},  # no website → skipped
    ]}}
    ents = companies.parse_bindings(doc)
    assert len(ents) == 1
    assert ents[0].organization == "Acme Corp"
    assert ents[0].domain == "acme.com"
    assert ents[0].location == "United States"
    assert ents[0].source == "companies"


# --- SEC EDGAR --------------------------------------------------------------- #
def test_guess_domain():
    assert edgar.guess_domain("Apple Inc.") == "apple.com"
    assert edgar.guess_domain("Bright Spark Robotics Corporation") == "brightsparkrobotics.com"
    assert edgar.guess_domain("") == ""


def test_parse_tickers_filters_by_term():
    data = {
        "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft Corp"},
        "2": {"cik_str": 1, "ticker": "NVDA", "title": "NVIDIA Corp"},
    }
    ents = edgar.parse_tickers(data, "microsoft", limit=10)
    assert len(ents) == 1
    assert ents[0].organization == "Microsoft Corp"
    assert ents[0].domain == "microsoft.com"
    assert ents[0].extra["domain_guessed"] is True
    assert ents[0].source == "edgar"


def test_parse_tickers_no_term_returns_some():
    data = {"0": {"cik_str": 1, "ticker": "A", "title": "Alpha Inc"},
            "1": {"cik_str": 2, "ticker": "B", "title": "Beta Corp"}}
    ents = edgar.parse_tickers(data, "", limit=10)
    assert len(ents) == 2
