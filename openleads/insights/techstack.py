"""
Technographics — which tools a company's website runs, from its homepage HTML.

"Dentists that book through Zocdoc", "Shopify stores", "agencies on HubSpot":
knowing a prospect's stack is how you write the first line of a relevant email. Paid
tools sell this; we read it from the same homepage we already fetch for people and
emails. Each signature is a script/asset host or a framework marker that only that
product leaves behind, so a word in a blog post never counts as a detection.
"""
from __future__ import annotations

import re

# (name, category, [regex markers]) — matched case-insensitively against raw HTML.
SIGNATURES = (
    # CMS / site builders
    ("WordPress", "CMS", [r"/wp-content/", r"/wp-includes/", r'generator"[^>]+wordpress']),
    ("Webflow", "Website builder", [r"assets\.website-files\.com", r"data-wf-site=",
                                    r"webflow\.js"]),
    ("Squarespace", "Website builder", [r"static1\.squarespace\.com", r"squarespace-cdn\.com"]),
    ("Wix", "Website builder", [r"static\.wixstatic\.com", r"static\.parastorage\.com"]),
    ("Framer", "Website builder", [r"framerusercontent\.com", r"framer\.com/m/"]),
    ("Duda", "Website builder", [r"irp\.cdn-website\.com", r"dudamobile"]),
    ("GoDaddy Website Builder", "Website builder", [r"img1\.wsimg\.com"]),
    ("Weebly", "Website builder", [r"weebly\.com/", r"editmysite\.com"]),
    ("Drupal", "CMS", [r"/sites/default/files/", r"drupal-settings-json", r"drupal\.settings"]),
    ("Joomla", "CMS", [r"/media/jui/", r'generator"[^>]+joomla']),
    ("Ghost", "CMS", [r'generator"[^>]+ghost', r"ghost\.io/"]),
    ("HubSpot CMS", "CMS", [r"hubspotusercontent", r"hs-sites\.com"]),
    ("Contentful", "CMS", [r"ctfassets\.net"]),
    ("Sanity", "CMS", [r"cdn\.sanity\.io"]),
    ("Elementor", "CMS", [r"/elementor/", r"elementor-kit"]),
    ("Yoast SEO", "SEO", [r"yoast seo", r"yoast-schema-graph"]),
    # E-commerce
    ("Shopify", "E-commerce", [r"cdn\.shopify\.com", r"shopify\.theme", r"myshopify\.com"]),
    ("WooCommerce", "E-commerce", [r"/plugins/woocommerce/", r"woocommerce-"]),
    ("BigCommerce", "E-commerce", [r"cdn\d*\.bigcommerce\.com"]),
    ("Magento", "E-commerce", [r"mage/cookies", r"magento_", r"/static/version\d+/frontend/"]),
    ("Square Online", "E-commerce", [r"squareup\.com", r"square-marketplace"]),
    # Analytics
    ("Google Analytics", "Analytics", [r"google-analytics\.com/(?:analytics|ga)\.js",
                                       r"googletagmanager\.com/gtag/js", r"gtag\('config'"]),
    ("Google Tag Manager", "Tag manager", [r"googletagmanager\.com/gtm\.js", r"gtm-[a-z0-9]{5,8}"]),
    ("Segment", "Analytics", [r"cdn\.segment\.com/analytics"]),
    ("Mixpanel", "Analytics", [r"cdn\.mxpnl\.com", r"mixpanel\.init\("]),
    ("Amplitude", "Analytics", [r"cdn\.amplitude\.com", r"amplitude\.getinstance"]),
    ("Heap", "Analytics", [r"cdn\.heapanalytics\.com"]),
    ("PostHog", "Analytics", [r"posthog\.init\(", r"[a-z.]*posthog\.com/static/array\.js"]),
    ("Plausible", "Analytics", [r"plausible\.io/js/"]),
    ("Fathom", "Analytics", [r"cdn\.usefathom\.com"]),
    ("Hotjar", "Analytics", [r"static\.hotjar\.com", r"hotjar\.com/c/hotjar-"]),
    ("Microsoft Clarity", "Analytics", [r"clarity\.ms/tag/"]),
    # Advertising pixels
    ("Meta Pixel", "Advertising", [r"connect\.facebook\.net/[a-z_]+/fbevents\.js",
                                   r"fbq\('init'"]),
    ("LinkedIn Insight Tag", "Advertising", [r"snap\.licdn\.com/li\.lms-analytics",
                                             r"_linkedin_partner_id"]),
    ("Google Ads", "Advertising", [r"googleadservices\.com/pagead", r"googleads\.g\.doubleclick"]),
    ("TikTok Pixel", "Advertising", [r"analytics\.tiktok\.com"]),
    ("X Ads", "Advertising", [r"static\.ads-twitter\.com"]),
    # Marketing automation / CRM / email
    ("HubSpot", "Marketing automation", [r"js\.hs-scripts\.com", r"js\.hsforms\.net",
                                         r"js\.hs-analytics\.net", r"js\.hubspot\.com"]),
    ("Marketo", "Marketing automation", [r"munchkin\.marketo\.net", r"mktoforms2"]),
    ("Pardot", "Marketing automation", [r"pi\.pardot\.com", r"pardot\.com/pd\.js"]),
    ("ActiveCampaign", "Marketing automation", [r"trackcmp\.net", r"activehosted\.com"]),
    ("Mailchimp", "Email marketing", [r"chimpstatic\.com", r"list-manage\.com"]),
    ("Klaviyo", "Email marketing", [r"static\.klaviyo\.com", r"klaviyo\.com/onsite"]),
    ("Salesforce", "CRM", [r"force\.com/", r"salesforceliveagent", r"webto\.salesforce\.com"]),
    ("Zoho", "CRM", [r"salesiq\.zoho", r"zohopublic\.com", r"crm\.zoho\.com"]),
    ("Pipedrive", "CRM", [r"leadbooster-chat\.pipedrive\.com", r"webforms\.pipedrive\.com"]),
    # Chat / support
    ("Intercom", "Live chat", [r"widget\.intercom\.io", r"js\.intercomcdn\.com",
                               r"intercomsettings"]),
    ("Drift", "Live chat", [r"js\.driftt\.com"]),
    ("Zendesk", "Customer support", [r"static\.zdassets\.com", r"zopim"]),
    ("Crisp", "Live chat", [r"client\.crisp\.chat"]),
    ("Tawk.to", "Live chat", [r"embed\.tawk\.to"]),
    ("LiveChat", "Live chat", [r"cdn\.livechatinc\.com"]),
    ("Freshdesk", "Customer support", [r"wchat\.freshchat\.com", r"freshdesk\.com/widget"]),
    ("Podium", "Reviews & messaging", [r"connect\.podium\.com", r"podium\.com/widget"]),
    ("Birdeye", "Reviews & messaging", [r"birdeye\.com/embed", r"birdeye-widget"]),
    ("Trustpilot", "Reviews & messaging", [r"widget\.trustpilot\.com"]),
    # Scheduling / booking (the local-business stack)
    ("Calendly", "Scheduling", [r"assets\.calendly\.com", r"calendly\.com/[a-z0-9_-]+"]),
    ("Acuity Scheduling", "Scheduling", [r"acuityscheduling\.com"]),
    ("Zocdoc", "Scheduling", [r"zocdoc\.com/(?:practice|doctor|widget)", r"offsiteschedule\.zocdoc"]),
    ("NexHealth", "Scheduling", [r"nexhealth\.com"]),
    ("Jane App", "Scheduling", [r"\.janeapp\.com"]),
    ("Mindbody", "Scheduling", [r"mindbodyonline\.com", r"healcode\.com"]),
    ("Vagaro", "Scheduling", [r"vagaro\.com"]),
    ("OpenTable", "Scheduling", [r"opentable\.com/widget", r"otstatic\.com"]),
    ("Toast", "Point of sale", [r"toasttab\.com"]),
    ("Housecall Pro", "Field service", [r"housecallpro\.com"]),
    ("Jobber", "Field service", [r"getjobber\.com", r"clienthub\.getjobber"]),
    ("ServiceTitan", "Field service", [r"servicetitan\.com", r"scheduler\.servicetitan"]),
    # Payments
    ("Stripe", "Payments", [r"js\.stripe\.com"]),
    ("PayPal", "Payments", [r"paypal\.com/sdk/js", r"paypalobjects\.com"]),
    # Forms
    ("Typeform", "Forms", [r"embed\.typeform\.com"]),
    ("Jotform", "Forms", [r"jotform\.com/", r"jotfor\.ms"]),
    ("Gravity Forms", "Forms", [r"gform_wrapper", r"/plugins/gravityforms/"]),
    # Frameworks / hosting / infra
    ("Next.js", "JavaScript framework", [r"__next_data__", r"/_next/static/"]),
    ("Nuxt", "JavaScript framework", [r"__nuxt__", r"/_nuxt/"]),
    ("Gatsby", "JavaScript framework", [r"___gatsby", r"/page-data/app-data\.json"]),
    ("React", "JavaScript framework", [r"data-reactroot", r"react-dom(?:\.production)?\.min\.js",
                                       r"__next_data__"]),
    ("Vue.js", "JavaScript framework", [r"vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.min\.js",
                                        r"data-v-[0-9a-f]{8}"]),
    ("Angular", "JavaScript framework", [r"ng-version=", r"angular(?:\.min)?\.js"]),
    ("SvelteKit", "JavaScript framework", [r"__sveltekit", r"/_app/immutable/"]),
    ("jQuery", "JavaScript library", [r"jquery(?:-\d[\d.]*)?(?:\.min)?\.js"]),
    ("Bootstrap", "UI framework", [r"bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)"]),
    ("Tailwind CSS", "UI framework", [r"tailwindcss", r"cdn\.tailwindcss\.com"]),
    ("Cloudflare", "CDN", [r"/cdn-cgi/", r"cdnjs\.cloudflare\.com",
                           r"static\.cloudflareinsights\.com"]),
    ("Vercel", "Hosting", [r"/_vercel/insights", r"vercel\.live"]),
    ("Netlify", "Hosting", [r"netlify-identity-widget", r"\.netlify\.app"]),
    ("Google Fonts", "Fonts", [r"fonts\.googleapis\.com"]),
    ("Adobe Fonts", "Fonts", [r"use\.typekit\.net"]),
    ("Font Awesome", "Fonts", [r"fontawesome", r"font-awesome"]),
    ("Google Maps", "Maps", [r"maps\.googleapis\.com/maps/api/js", r"google\.com/maps/embed"]),
    ("YouTube", "Video", [r"youtube\.com/embed/", r"youtube-nocookie\.com/embed/"]),
    ("Vimeo", "Video", [r"player\.vimeo\.com"]),
    ("Wistia", "Video", [r"fast\.wistia\.(?:com|net)"]),
    ("reCAPTCHA", "Security", [r"google\.com/recaptcha", r"recaptcha/api\.js"]),
    ("hCaptcha", "Security", [r"hcaptcha\.com/1/api\.js"]),
    ("OneTrust", "Consent", [r"cdn\.cookielaw\.org", r"optanon"]),
    ("Cookiebot", "Consent", [r"consent\.cookiebot\.com"]),
    ("Optimizely", "A/B testing", [r"cdn\.optimizely\.com"]),
    ("VWO", "A/B testing", [r"visualwebsiteoptimizer\.com"]),
    ("Sentry", "Monitoring", [r"browser\.sentry-cdn\.com", r"sentry\.init\("]),
    ("New Relic", "Monitoring", [r"js-agent\.newrelic\.com", r"nreum"]),
    ("Algolia", "Search", [r"algolia(?:net)?\.(?:com|net)", r"algoliasearch"]),
)

_COMPILED = tuple((name, cat, re.compile("|".join(markers), re.I))
                  for name, cat, markers in SIGNATURES)
CATEGORIES = tuple(sorted({cat for _, cat, _ in SIGNATURES}))
NAMES = tuple(name for name, _, _ in SIGNATURES)


def detect(html_text: str) -> list:
    """``[{name, category}]`` for every technology the page shows a marker for."""
    page = html_text or ""
    if not page:
        return []
    return [{"name": name, "category": cat} for name, cat, rx in _COMPILED if rx.search(page)]


def names(html_text: str) -> list:
    """Just the technology names (for compact storage and filtering)."""
    return [t["name"] for t in detect(html_text)]


def by_category(techs: list) -> dict:
    """Group ``[{name, category}]`` into ``{category: [names]}`` for display."""
    out: dict = {}
    for t in techs or []:
        out.setdefault(t.get("category") or "Other", []).append(t.get("name"))
    return out
