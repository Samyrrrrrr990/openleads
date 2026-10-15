"""
The workspace — OpenLeads' local, Apollo-style sales workspace.

Everything a team does after a search lives here, in the same SQLite file as the
CRM (``~/.openleads/openleads.db``):

* :mod:`~openleads.workspace.stages`     — contact/account/deal stage vocabularies
* :mod:`~openleads.workspace.people`     — filter, sort, page and edit contacts
* :mod:`~openleads.workspace.companies`  — accounts rolled up from contacts
* :mod:`~openleads.workspace.lists`      — static lists of people or companies
* :mod:`~openleads.workspace.tags`       — free-form labels on contacts
* :mod:`~openleads.workspace.notes`      — notes on contacts, companies and deals
* :mod:`~openleads.workspace.activity`   — one timeline of everything that happened
* :mod:`~openleads.workspace.tasks`      — calls, emails, LinkedIn steps and to-dos
* :mod:`~openleads.workspace.deals`      — a pipeline of opportunities
* :mod:`~openleads.workspace.templates`  — email templates with {{variables}}
* :mod:`~openleads.workspace.sequences`  — multi-step, multi-channel sequences
* :mod:`~openleads.workspace.saved`      — saved searches
* :mod:`~openleads.workspace.scoring`    — an ICP fit score per contact
* :mod:`~openleads.workspace.importer`   — CSV import with header auto-mapping
* :mod:`~openleads.workspace.duplicates` — duplicate detection and merge
* :mod:`~openleads.workspace.stats`      — home dashboard numbers and data health

Each module takes an open :class:`openleads.db.DB` and is unit-tested against a
temporary database. Nothing here touches the network.
"""
