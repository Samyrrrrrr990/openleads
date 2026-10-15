"""HubSpot exports use invented contacts and injected, network-free HTTP clients."""
import io
import json
import urllib.error
import urllib.parse
import urllib.response

import pytest

from openleads.automate import exporters
from openleads.models import Lead


@pytest.fixture(autouse=True)
def hubspot_token(monkeypatch):
    monkeypatch.setattr(exporters.settings, "get", lambda key: "fake-private-token")


def no_request(*args):
    pytest.fail("unexpected HTTP request")


def test_profile_mapping_omits_empty_and_unrelated_fields():
    lead = {"email": "ada@example.test", "first_name": " Ada ", "last_name": "Example",
            "organization": "Example Co", "title": "Engineer", "phone": "+1 202 555 0100",
            "website": "https://example.test", "city": "Testville", "country": "Exampleland",
            "signals": {"private": "not a contact property"}, "tier": "safe"}
    assert exporters.hubspot_properties(lead) == {
        "firstname": "Ada", "lastname": "Example", "company": "Example Co", "jobtitle": "Engineer",
        "phone": "+1 202 555 0100", "website": "https://example.test", "city": "Testville",
        "country": "Exampleland",
    }
    assert exporters.hubspot_properties({"first_name": " ", "last_name": None, "phone": 123}) == {}


@pytest.mark.parametrize("token", [None, "", " \t "])
def test_missing_token_never_calls_http(monkeypatch, token):
    monkeypatch.setattr(exporters.settings, "get", lambda key: token)
    result = exporters.export([Lead(email="ada@example.test")], "hubspot", requester=no_request)
    assert result == {"ok": False, "sink": "hubspot", "count": 0, "error": "set hubspot_token first"}


@pytest.mark.parametrize("email", [None, "", " \t ", 123])
def test_missing_email_is_validated_before_any_writes(email):
    result = exporters.export([Lead(email="ada@example.test"), {"email": email}],
                              "hubspot", requester=no_request)
    assert not result["ok"] and result["count"] == 0
    assert result["error"] == "HubSpot requires an email for lead 2"


def test_empty_export_does_not_call_http():
    assert exporters.export([], "hubspot", requester=no_request) == {
        "ok": True, "sink": "hubspot", "count": 0,
    }


def test_create_then_update_preserves_sparse_fields_and_does_not_duplicate():
    contacts, calls = {}, []

    def requester(method, url, body, headers):
        calls.append((method, url))
        assert headers == {"Authorization": "Bearer fake-private-token", "Content-Type": "application/json"}
        properties = json.loads(body)["properties"]
        if method == "PATCH":
            email = urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[1])
            assert "email" not in properties  # Do not change an existing contact's primary email.
            if email not in contacts:
                return 404, '{"status":"error","category":"OBJECT_NOT_FOUND"}'
            contacts[email].update(properties)
            return 200, json.dumps({"id": "101", "properties": contacts[email], "archived": False})
        assert method == "POST"
        assert url == "https://api.hubapi.com/crm/v3/objects/contacts"
        assert properties["email"] not in contacts
        contacts[properties["email"]] = properties
        return 201, json.dumps({"id": "101", "properties": properties, "archived": False})

    lead = Lead(email="ada+test/#?@example.test", first_name="Ada", last_name="Example", phone="555-0100")
    assert exporters.export([lead], "hubspot", requester=requester)["count"] == 1
    result = exporters.export([{"email": lead.email, "first_name": "Augusta", "last_name": " ",
                                "phone": None}], "hubspot", target="https://untrusted.test", requester=requester)
    assert result == {"ok": True, "sink": "hubspot", "count": 1}
    assert contacts == {lead.email: {"email": lead.email, "firstname": "Augusta", "lastname": "Example",
                                    "phone": "555-0100"}}
    assert [method for method, url in calls] == ["PATCH", "POST", "PATCH"]
    assert calls[0][1] == (
        "https://api.hubapi.com/crm/v3/objects/contacts/ada%2Btest%2F%23%3F%40example.test?idProperty=email"
    )


@pytest.mark.parametrize("last_status", [200, 404, 409, 429, 503])
def test_create_conflict_retries_update_only_once(last_status):
    calls = []
    responses = iter([(404, ""), (409, ""), (last_status, '{"id":"101"}')])

    def requester(method, url, body, headers):
        calls.append(method)
        return next(responses)

    result = exporters.export([Lead(email="ada@example.test")], "hubspot", requester=requester)
    assert calls == ["PATCH", "POST", "PATCH"]
    assert result["ok"] is (last_status == 200)
    assert result["count"] == int(last_status == 200)


@pytest.mark.parametrize("status, hint", [(400, "HTTP 400"), (401, "hubspot_token"),
                                         (403, "crm.objects.contacts.write"), (409, "HTTP 409"),
                                         (429, "rate limit"), (500, "HTTP 500"), (503, "HTTP 503")])
@pytest.mark.parametrize("creating", [False, True])
def test_failure_stops_without_retry_or_extra_creates(status, hint, creating):
    calls = []

    def requester(method, url, body, headers):
        calls.append(method)
        if creating and len(calls) == 1:
            return 404, ""
        return status, "fake-private-token ada@example.test raw upstream error"

    result = exporters.export([Lead(email="ada@example.test"), Lead(email="grace@example.test")],
                              "hubspot", requester=requester)
    expected = ["PATCH", "POST", "PATCH"] if creating and status == 409 else (
        ["PATCH", "POST"] if creating else ["PATCH"]
    )
    assert calls == expected
    assert not result["ok"] and result["count"] == 0
    assert hint in result["error"]
    assert "fake-private-token" not in str(result) and "ada@example.test" not in str(result)


@pytest.mark.parametrize("error", [TimeoutError("fake-private-token ada@example.test"),
                                  urllib.error.URLError("fake-private-token ada@example.test")])
def test_transport_failure_is_sanitized_and_keeps_confirmed_count(error):
    calls = []

    def requester(method, url, body, headers):
        calls.append(method)
        if len(calls) == 1:
            return 200, '{"id":"101"}'
        raise error

    result = exporters.export([Lead(email=f"contact{i}@example.test") for i in range(3)],
                              "hubspot", requester=requester)
    assert calls == ["PATCH", "PATCH"]
    assert not result["ok"] and result["count"] == 1
    assert "network error" in result["error"] and "lead 2" in result["error"]
    assert "fake-private-token" not in str(result) and "@example.test" not in str(result)


@pytest.mark.parametrize("body", ["", "not JSON", "null", "[]", '"text"', "{}",
                                 '{"id":null}', '{"id":[]}', '{"id":" "}',
                                 '{"id":"101","archived":true}', '{"id":"101","status":"error"}',
                                 '{"status":"error","message":"fake-private-token"}'])
def test_success_requires_a_contact_confirmation(body):
    result = exporters.export([Lead(email="ada@example.test")], "hubspot",
                              requester=lambda *args: (200, body))
    assert not result["ok"] and result["count"] == 0
    assert "did not confirm" in result["error"] and "fake-private-token" not in result["error"]


@pytest.mark.parametrize("status", [202, 204, 207, 301, 302, 307, 308])
def test_nonfinal_success_and_redirects_are_not_confirmation(status):
    result = exporters.export([Lead(email="ada@example.test")], "hubspot",
                              requester=lambda *args: (status, '{"id":"101"}'))
    assert not result["ok"] and result["count"] == 0


def test_stdlib_transport_sends_patch_and_create_with_timeout(monkeypatch):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            assert timeout == 20
            assert request.get_header("Authorization") == "Bearer fake-private-token"
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, io.BytesIO(b"private"))
            response = io.BytesIO(b'{"id":"101"}')
            response.status = 201
            return response

    def build_opener(handler):
        assert isinstance(handler, exporters._HubSpotNoRedirect)
        return Opener()

    monkeypatch.setattr(exporters.urllib.request, "build_opener", build_opener)
    result = exporters.export([Lead(email="ada@example.test", first_name="Ada")], "hubspot")
    assert result["ok"] and result["count"] == 1
    assert [req.get_method() for req in calls] == ["PATCH", "POST"]
    assert json.loads(calls[1].data) == {"properties": {"firstname": "Ada", "email": "ada@example.test"}}


def test_stdlib_transport_refuses_redirects():
    calls = []

    class HTTPSHandler(exporters.urllib.request.HTTPSHandler):
        def https_open(self, request):
            calls.append(request.full_url)
            response = urllib.response.addinfourl(
                io.BytesIO(b""), {"location": "https://other.test"}, request.full_url, 302)
            response.msg = "Found"
            return response

    opener = exporters.urllib.request.build_opener(exporters._HubSpotNoRedirect(), HTTPSHandler())
    request = exporters.urllib.request.Request("https://api.hubapi.com/crm/v3/objects/contacts",
                                               data=b"{}", headers={"Authorization": "Bearer fake-token"})
    with pytest.raises(urllib.error.HTTPError) as error:
        opener.open(request, timeout=20)
    assert error.value.code == 302
    assert calls == [request.full_url]
    error.value.close()


@pytest.mark.parametrize("status", [401, 403, 429, 503, None])
def test_stdlib_transport_sanitizes_errors_and_closes_responses(monkeypatch, status):
    response = io.BytesIO(b"fake-private-token ada@example.test")
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            if status is None:
                raise urllib.error.URLError("fake-private-token ada@example.test")
            raise urllib.error.HTTPError(request.full_url, status, "private", {}, response)

    monkeypatch.setattr(exporters.urllib.request, "build_opener", lambda *args: Opener())
    result = exporters.export([Lead(email="ada@example.test")], "hubspot")
    assert len(calls) == 1 and not result["ok"] and result["count"] == 0
    assert "fake-private-token" not in str(result) and "ada@example.test" not in str(result)
    if status is not None:
        assert response.closed


def test_cli_and_sink_registry_accept_hubspot():
    from openleads.cli import build_parser
    assert build_parser().parse_args(["export", "hubspot"]).sink == "hubspot"
    assert "hubspot" in exporters.SINKS
