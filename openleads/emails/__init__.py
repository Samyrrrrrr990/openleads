"""The universal email-finding engine (vertical-agnostic).

Given a person's name and an email domain, this package:

1. confirms the domain accepts mail (MX lookup, cross-checked across resolvers),
2. generates likely local-parts (permutations),
3. verifies candidates over SMTP without sending mail (RCPT probe + catch-all),
4. produces an explainable 0-100 confidence score.

``mailcheck`` / ``email`` would clash with the stdlib, so this package is
deliberately named ``emails``.
"""
from openleads.emails.resolve import find_email

__all__ = ["find_email"]
