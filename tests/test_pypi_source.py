```python
from openleads.sources.pypi import parse_results


def test_parse_package_with_public_email():
    data = {
        "info": {
            "name": "sample-package",
            "author": "Test Maintainer",
            "author_email": "test@example.com",
            "summary": "A sample package",
            "project_url": "https://pypi.org/project/sample-package/",
            "home_page": "https://example.com",
            "project_urls": {},
        }
    }

    results = parse_results(data)

    assert len(results) == 1
    assert results[0].full_name == "Test Maintainer"
    assert results[0].extra["public_email"] == "test@example.com"
    assert results[0].domain == "example.com"


def test_skip_package_without_maintainer_name():
    data = {
        "info": {
            "name": "sample-package",
            "author": "",
            "maintainer": "",
        }
    }

    assert parse_results(data) == []


def test_empty_response():
    assert parse_results({}) == []


def test_shared_hosting_domain_is_not_used():
    data = {
        "info": {
            "name": "sample-package",
            "author": "Test Maintainer",
            "home_page": "https://github.com/example/project",
            "project_url": "https://pypi.org/project/sample-package/",
            "project_urls": {},
        }
    }

    results = parse_results(data)

    assert len(results) == 1
    assert results[0].domain == ""
```
