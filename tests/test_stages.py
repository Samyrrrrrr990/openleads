"""Stage vocabularies and automatic transitions."""
from openleads.workspace import stages


def test_auto_stage_rules():
    assert stages.auto_stage("new", "sent") == "approaching"
    assert stages.auto_stage("", "sent") == "approaching"
    assert stages.auto_stage("interested", "sent") is None
    assert stages.auto_stage("approaching", "replied") == "replied"
    assert stages.auto_stage("meeting", "replied") is None
    assert stages.auto_stage("interested", "bounced") == "bad_data"
    assert stages.auto_stage("customer", "unsubscribed") == "do_not_contact"
    assert stages.auto_stage("new", "queued") is None


def test_options_and_labels():
    opts = stages.as_options()
    assert opts[0] == {"key": "new", "label": "New", "tone": "neutral"}
    deal = stages.as_options(stages.DEAL_STAGES)
    assert deal[-2] == {"key": "won", "label": "Won", "probability": 100}
    assert stages.label("do_not_contact") == "Do not contact"
    assert stages.label("mystery_stage") == "Mystery stage"
    assert set(stages.OPEN_DEAL_STAGES) < set(stages.DEAL_STAGE_KEYS)
