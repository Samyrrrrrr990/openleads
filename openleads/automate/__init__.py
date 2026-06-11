"""
Local automations — the glue that makes OpenLeads a one-command outreach machine.

* ``pipeline`` — find → verify → write → send in a single call (the engine behind
  ``openleads run`` and the web app's 4-click flow).
* ``crm`` — a local view over everyone you've found and every email you've sent.
* ``dedupe`` — never contact the same person twice; import do-not-contact lists.
* ``scheduler`` — drip daily without babysitting (foreground loop or cron snippet).
* ``templates`` — reusable message templates with A/B subject selection.

Everything runs locally against the SQLite DB; no servers, no PII leaves the box.
"""
