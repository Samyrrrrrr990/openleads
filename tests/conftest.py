"""Shared test fixtures: isolate OpenLeads' home dir so tests never touch ~/.openleads."""
import os
import tempfile

import pytest


@pytest.fixture(autouse=True, scope="session")
def _isolated_home():
    tmp = tempfile.mkdtemp(prefix="openleads-test-")
    os.environ["OPENLEADS_HOME"] = tmp
    yield tmp
