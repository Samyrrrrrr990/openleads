"""
Insights — turn the raw strings a source hands us into the structured fields a
sales team filters on: seniority and department from a job title, a headcount
bucket from an employee count, phone numbers, social profiles, the technologies a
company's website runs, and a company profile from its homepage.

Everything here is pure (text in, structured data out) except
:func:`openleads.insights.company.fetch_company_profile`, which does one cached GET.
"""
