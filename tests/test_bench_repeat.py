"""bench --repeat: median run with min–max, and a Notes column (offline)."""
from openleads import bench, cli


def test_repeat_reports_the_median_run_and_spread(monkeypatch):
    runs = iter([(4, 30.0, ""), (9, 20.0, ""), (6, 25.0, "local: timeout — stopped")])

    def fake(text, count=10, budget=60, cache=None, db=None):
        leads, secs, problem = next(runs)
        return bench.QueryScore(query=text, leads=leads, seconds=secs, problem=problem)
    monkeypatch.setattr(bench, "score_query", fake)
    rep = bench.run(["dentists in Austin"], count=10, repeat=3)
    q = rep["queries"][0]
    assert (q["leads"], q["repeat"]) == (6, 3)
    assert q["leads_range"] == [4, 6, 9] and q["seconds_range"] == [20.0, 25.0, 30.0]
    md = bench.to_markdown(rep)
    assert "| Seconds | Notes |" in md and "each run 3×" in md
    assert "| 6 (4–9) |" in md and "local: timeout — stopped |" in md


def test_single_run_keeps_the_old_shape(monkeypatch):
    monkeypatch.setattr(bench, "score_query", lambda text, **kw: bench.QueryScore(
        query=text, leads=3, seconds=1.5, error="hn: failed — a|b"))
    md = bench.to_markdown(bench.run(["x"], count=10))
    assert "| x | 3 |" in md and "a\\|b" in md and "×" not in md


def test_cli_accepts_repeat(monkeypatch, capsys):
    seen = {}

    def fake_run(queries, count=10, budget=60, cache=None, db=None, on_result=None, repeat=1):
        seen["repeat"] = repeat
        return bench.report([], count=count, repeat=repeat)
    monkeypatch.setattr(bench, "run", fake_run)
    assert cli.main(["bench", "x", "--repeat", "3", "--no-cache"]) == 0
    assert seen["repeat"] == 3 and "3 runs each" in capsys.readouterr().out
