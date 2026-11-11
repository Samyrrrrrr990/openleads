"""
The keyless writer's phrase library.

Every line is a template over values taken from the brief (``{company}``,
``{topic_object}``, …) plus the facts it *requires*. A line is only eligible when
the brief has everything it needs, so a line can never mention something we don't
know. Lines that make a general observation ("for most practices, …") are phrased
as patterns, never as claims about this lead.

Angles:

* ``mutual-signal`` — lead with a real, recent signal (hiring, YC, a repo, a paper).
* ``compliment``    — an honest observation about something we can see (their
                      homepage line, their stack). No "big fan", no "loved your post".
* ``curiosity``     — a question about how they handle what the pitch is about.
* ``pain``          — a common problem for people in their role/vertical, as a pattern.
* ``short-ask``     — two lines: what we do, is it relevant?

Company contacts (``info@``, ``office@``) get the ``inbox`` set: who should I talk to.
"""
from __future__ import annotations

ANGLES = ("mutual-signal", "compliment", "curiosity", "pain", "short-ask")
TONES = ("plain", "warm", "direct", "casual")
REWRITES = ("shorter", "warmer", "more direct", "more casual")

# (id, requires, template, why)
OPENERS = {
    "mutual-signal": (
        ("hiring-short", ("signal.hiring",),
         "Saw {company} is hiring{hiring_detail}, so I'll keep this short.",
         "a real signal: they're hiring ({hiring_source})"),
        ("hiring-plate", ("signal.hiring", "topic"),
         "Saw {company} is hiring{hiring_detail}, so I guessed {topic_object} might be on your plate.",
         "a real signal: they're hiring ({hiring_source})"),
        ("hn-post", ("signal.hn_post",),
         "Saw {company_pos} post in the Hacker News hiring thread.",
         "a real signal: their Hacker News hiring post"),
        ("yc-short", ("signal.yc",),
         "Saw {company} is a Y Combinator company{batch_detail}, so I'll keep this short.",
         "a real signal: Y Combinator company"),
        ("yc-came", ("signal.yc",),
         "Noticed {company} came through Y Combinator{batch_detail}.",
         "a real signal: Y Combinator company"),
        ("yc-saw", ("signal.yc", "topic"),
         "Saw {company} is in the Y Combinator directory{batch_detail}, and had a question about "
         "{topic_object}.",
         "a real signal: Y Combinator company"),
        ("github", ("signal.github", "repo_real"),
         "Came across {repo_real} on GitHub.",
         "a real signal: their GitHub"),
        ("paper", ("signal.paper",),
         "Came across your paper, \"{paper}\".",
         "a real signal: their paper"),
        ("producthunt", ("signal.producthunt",),
         "Saw {company} on Product Hunt.",
         "a real signal: their Product Hunt launch"),
        ("bio", ("person.bio", "signal.github"),
         "Came across your GitHub profile (\"{bio}\").",
         "a real signal: their GitHub profile and bio"),
        ("tech-overlap", ("tech_overlap",),
         "Noticed {company} runs on {tech_overlap}, which is what we work with.",
         "their stack overlaps with your pitch"),
    ),
    "compliment": (
        ("bio-line", ("person.bio",),
         "Liked the line in your profile: \"{bio}\".",
         "their own profile bio"),
        ("desc-quote", ("company.description",),
         "Your site sums up {company} in one line: \"{desc}\". That's rarer than it should be.",
         "their homepage one-liner"),
        ("desc-clear", ("company.description",),
         "Had a look at {company_pos} site (\"{desc}\"), and it's clear who you're for.",
         "their homepage one-liner"),
        ("tech-setup", ("tech2",),
         "Had a look at {company_pos} site, and nice to see {tech_list} in the stack.",
         "their tech stack, from the homepage"),
        ("yc-congrats", ("signal.yc", "leader"),
         "Congrats on getting {company} into Y Combinator{batch_detail}.",
         "Y Combinator company"),
        ("github-nice", ("signal.github", "repo_real"),
         "Nice work on {repo}.",
         "their GitHub"),
        ("paper-congrats", ("signal.paper",),
         "Congrats on your paper, \"{paper}\".",
         "their paper"),
        ("hiring-good", ("signal.hiring",),
         "Saw {company} is hiring{hiring_detail}, which is always a good sign.",
         "they're hiring"),
    ),
    "curiosity": (
        ("handle", ("company", "topic"),
         "Quick question: how does {company} handle {topic_object} today?",
         "a question about what your pitch solves"),
        ("in-house", ("company", "topic"),
         "Curious how {company} handles {topic_object} right now. In-house, or with a tool?",
         "a question about what your pitch solves"),
        ("tech-topic", ("company", "tech_topic", "topic"),
         "Noticed {company} uses {tech_topic}. Does that cover {topic_object} for you, or is part of it "
         "still manual?",
         "their tool for the problem your pitch solves"),
        ("team-size", ("company", "employees", "topic"),
         "With {employees} people at {company}, how are you handling {topic_object}?",
         "their team size"),
    ),
    "pain": (
        ("pain-1", ("topic", "pain1"), "{pain1}", "a common problem for {who}"),
        ("pain-2", ("topic", "pain2"), "{pain2}", "a common problem for {who}"),
    ),
    "short-ask": (),
    "inbox": (
        ("inbox-reach", ("company", "topic"),
         "I'm trying to reach whoever looks after {topic_object} at {company}.",
         "a shared inbox: ask for the right person"),
        ("inbox-point", ("company",),
         "I'm hoping to reach the right person at {company} for this.",
         "a shared inbox: ask for the right person"),
        ("inbox-hiring", ("company", "signal.hiring"),
         "Saw {company} is hiring{hiring_detail}, so I'll keep this short.",
         "a shared inbox + a real hiring signal"),
    ),
}

# A second sentence that says why *this person*: uses their title or role.
ROLE_LINES = (
    ("role-ask", ("person.title",), "Figured you'd be the right person to ask as {title} there.",
     "their title"),
    ("role-know", ("person.title", "company"),
     "As {title} at {company}, you'd know better than anyone if this is useful.", "their title"),
    ("leader", ("leader", "company"), "Since you're running things at {company}, I came straight to you.",
     "they lead the company"),
)

# Patterns per pitch topic, said about a group ({who}), never about this lead.
PAINS = {
    "bookings": (
        "For most {who}, no-shows and last-minute cancellations quietly eat a few hours every week.",
        "Empty slots in the schedule are one of those costs {who} rarely see on a report.",
    ),
    "meetings": (
        "For most {who}, the hard part isn't the pitch, it's getting enough of the right meetings on the "
        "calendar.",
        "A lot of {who} end up with a pipeline that depends on referrals and a few busy weeks.",
    ),
    "hiring": (
        "For most {who}, every open role means weeks of sourcing before the first good interview.",
        "Hiring tends to eat the calendars of the people {who} can least spare.",
    ),
    "marketing": (
        "For a lot of {who}, plenty of people find the site but far fewer of them get in touch.",
        "Most {who} know marketing matters but rarely have the hours to keep it going every week.",
    ),
    "payments": (
        "For most {who}, chasing invoices and failed payments takes more time than it should.",
        "Payments are one of those things {who} only notice when something breaks.",
    ),
    "engineering": (
        "Most {who} lose more time to tooling and slow pipelines than to the product itself.",
        "For a lot of {who}, the build and deploy setup gets attention only when it breaks.",
    ),
    "data": (
        "For most {who}, the numbers live in five tools and nobody fully trusts the dashboard.",
        "A lot of {who} spend Monday mornings stitching reports together by hand.",
    ),
    "security": (
        "For most {who}, security reviews show up right when a big deal is about to close.",
        "Compliance work tends to land on {who} on top of everything else.",
    ),
    "finance": (
        "For most {who}, the books get attention once a month, usually too late to act on.",
        "Bookkeeping is one of those jobs {who} put off until it can't wait.",
    ),
    "ops": (
        "A lot of {who} still run key work through spreadsheets and copy-paste.",
        "For most {who}, the admin side grows faster than the team does.",
    ),
    "website": (
        "For most {who}, the website gets updated far less often than the business changes.",
        "A lot of {who} know their site could do more but never find the week to fix it.",
    ),
    "customers": (
        "For most {who}, support volume grows faster than the team does.",
        "A lot of {who} only hear about unhappy customers when they cancel.",
    ),
}

# (who for a leader, who for anyone else, singular noun)
AUDIENCE = {
    "dental": ("practice owners", "dental practices", "practice"),
    "medical": ("clinic owners", "clinics", "clinic"),
    "fitness": ("gym owners", "gyms and studios", "gym"),
    "beauty": ("salon owners", "salons", "salon"),
    "legal": ("managing partners", "law firms", "firm"),
    "accounting": ("firm partners", "accounting firms", "firm"),
    "home_services": ("owners of service businesses", "home service businesses", "business"),
    "food": ("owners in food and drink", "food and drink businesses", "business"),
    "real_estate": ("brokers", "real estate teams", "team"),
    "ecommerce": ("store owners", "online stores", "store"),
    "agency": ("agency owners", "agencies", "agency"),
    "fintech": ("fintech founders", "fintech teams", "team"),
    "logistics": ("logistics leaders", "logistics teams", "team"),
    "research": ("lab leads", "research groups", "group"),
    "developers": ("maintainers", "developers", "project"),
    "software": ("founders", "software teams", "team"),
    "general": ("founders and owners", "teams like yours", "team"),
}
ROLE_AUDIENCE = {
    "sales": "sales teams", "marketing": "marketing teams", "tech": "engineering teams",
    "people": "people teams", "finance": "finance teams", "clinical": "clinical teams",
}
OPS_AUDIENCE = {"dental": "practice managers", "medical": "practice managers",
                "legal": "office managers", "accounting": "office managers"}

GREETINGS = {"plain": "Hi", "warm": "Hi", "direct": "Hi", "casual": "Hey"}

CTAS = {
    "plain": ("Worth a quick chat next week?", "Open to a short call to see if it fits?",
              "Would a 15-minute call be worth it?"),
    "warm": ("Would you be open to a short chat? Happy to work around your schedule.",
             "If it sounds useful, could we find 15 minutes next week?"),
    "direct": ("Do you have 15 minutes this week?",
               "Can we find 15 minutes this week to see if it fits?"),
    "casual": ("Up for a quick chat?", "Worth a quick call?"),
}
OFFER_CTAS = {
    "plain": ("Open to {offer} next week?", "Would {offer} be useful?"),
    "warm": ("Would {offer} be helpful? Happy to work around your schedule.",
             "If it sounds useful, I'd be glad to set up {offer}."),
    "direct": ("Can we set up {offer} this week?", "Worth {offer} this week?"),
    "casual": ("Up for {offer}?", "Worth {offer}?"),
}
SHORT_ASK_CTAS = ("Is this on your radar at all?", "Worth a look, or not a priority right now?",
                  "Relevant for {company}, or should I leave it?")
INBOX_CTAS = ("Could you point me to the right person, or pass this along?",
              "Who would be the best person to talk to about this?")
SOFT_LINES = ("No worries if the timing's off.", "No pressure either way.")

SIGNOFFS = {"plain": ("Best,", "Thanks,"), "warm": ("Thanks so much,", "All the best,"),
            "direct": ("Thanks,", "Best,"), "casual": ("Cheers,", "Thanks,")}

# (id, requires, lowercase-casual, plain)
SUBJECTS = {
    "mutual-signal": (
        ("s-hiring", ("signal.hiring",), "saw you're hiring", "Saw you're hiring"),
        ("s-repo", ("signal.github", "repo_real", "repo_short"), "{repo}", "About {repo}"),
        ("s-paper", ("signal.paper",), "your paper", "Your paper"),
        ("s-pair", ("company", "sender_org"), "{company} + {sender_org}",
         "{company} and {sender_org}"),
        ("s-topic", ("company", "topic"), "{topic_short} at {company}",
         "{Topic_short} at {company}"),
        ("s-stack", ("tech_overlap", "company"), "{tech_overlap} at {company}",
         "{tech_overlap} at {company}"),
    ),
    "compliment": (
        ("s-note", ("first",), "quick note, {first}", "A quick note, {first}"),
        ("s-site", ("company", "company.description"), "{company_pos} site", "About {company_pos} site"),
        ("s-pair", ("company", "sender_org"), "{company} + {sender_org}",
         "{company} and {sender_org}"),
    ),
    "curiosity": (
        ("s-topic", ("company", "topic"), "{topic_short} at {company}",
         "Question about {topic_short} at {company}"),
        ("s-q", ("company",), "question about {company}", "Question about {company}"),
    ),
    "pain": (
        ("s-topic", ("company", "topic"), "{topic_short} at {company}", "{Topic_short} at {company}"),
        ("s-idea", ("company",), "idea for {company}", "An idea for {company}"),
    ),
    "short-ask": (
        ("s-quick", ("first",), "quick one, {first}", "Quick question, {first}"),
        ("s-look", (), "worth a look?", "Worth a look?"),
    ),
    "inbox": (
        ("s-who", ("company", "topic"), "who handles {topic_short} at {company}?",
         "Who handles {topic_short} at {company}?"),
        ("s-team", ("company",), "question for the {company} team", "Question for the {company} team"),
    ),
    "fallback": (
        ("s-quick", (), "quick question", "Quick question"),
    ),
}

# --- follow-ups --------------------------------------------------------------- #
FOLLOWUP_OPENERS = ("Following up on my note below.", "Bumping this in case it got buried.",
                    "One more thought on my last email.")
# (id, requires, template)
FOLLOWUP_ADDS = (
    ("proof", ("proof",), "{proof}"),
    ("question", ("company", "topic"), "Curious how {company} handles {topic_object} today."),
    ("pain", ("topic", "pain2"), "{pain2}"),
    ("overview", (), "If a call is too much, I can send a two-minute overview instead."),
)
FOLLOWUP_CTAS = ("Worth a quick look?", "Any interest?", "Should I send over a short overview?")
NUDGES = (
    "Is {topic_object} something {company} is looking at this quarter? A one-word reply is plenty.",
    "Should I keep {company} on my list, or is {topic_object} already covered?",
)
NUDGES_NO_TOPIC = ("Is this worth a conversation for {company}? A one-word reply is plenty.",
                   "Should I keep {company} on my list, or is the timing wrong?")
BREAKUPS = (
    "I'll close the loop here so I'm not filling up your inbox. If {topic_object} moves up the list "
    "later, just reply and I'll pick it back up.",
    "I haven't heard back, so I'll assume the timing isn't right. If that changes, reply anytime and "
    "I'll pick it up.",
)
BREAKUPS_NO_TOPIC = (
    "I'll close the loop here so I'm not filling up your inbox. If the timing is ever better, just reply "
    "and I'll pick it back up.",
)
INBOX_FOLLOWUPS = (
    "Following up in case this reached the wrong inbox. Who would be the best person to talk to about "
    "{topic_object} at {company}?",
    "Bumping this in case it's sitting in a shared inbox. Could you point me to whoever handles "
    "{topic_object}?",
)
INBOX_FOLLOWUPS_PLAIN = (
    "Following up in case this reached the wrong inbox. Who would be the best person to talk to?",
    "Bumping this in case it's sitting in a shared inbox. Could you pass it to the right person?",
)
FOLLOWUP_SUBJECT_FALLBACK = "quick question"

# Phrases that pretend a relationship or knowledge we don't have.
FAKE_FAMILIARITY = (
    "as we discussed", "as discussed", "great chatting", "great talking", "following up on our call",
    "per our conversation", "big fan", "huge fan", "i've been following", "i have been following",
    "loved your recent", "love your recent", "i loved your", "long time no", "hope you're well",
    "hope you are well", "hope this email finds you", "hope this finds you", "we met at",
    "nice meeting you", "as promised", "circling back on our", "you asked me to",
)
GENERIC_OPENERS = ("i came across your", "i wanted to reach out", "i'm reaching out", "i am reaching out",
                   "my name is", "i hope you", "just wanted to", "i noticed your company")
