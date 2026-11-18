/**
 * What a template's pages are, in one place.
 *
 * Every starter used to be a single page whose navigation named four others.
 * `nav('Northwind', ['Product', 'Pricing', 'Docs', 'Changelog'])` produced
 * four links with `href="#"`, and the footer produced nine more. So the first
 * thing anybody did with a template — click the thing at the top — did
 * nothing, in every template, on every link. A template that ships a
 * navigation bar is claiming to be a site; one page with nine dead links is
 * not a site, it is a page that says it is one.
 *
 * The fix is not "add more pages". It is to stop letting the two disagree:
 * a template declares its destinations here, the pages are built from that
 * list, and `nav` and `footer` are handed the same list. A link can then only
 * point at a page that exists, because there is nothing else for it to point
 * at, and a template that wants a fifth destination has to write the fifth
 * page to get the fifth link.
 */

export interface Destination {
  /** What the link says. */
  label: string;
  /** The page's path — the single source of both the link and the route. */
  path: string;
}

/** The home page every template has. */
export const HOME: Destination = { label: 'Home', path: '/' };

/**
 * A template's pages, in navigation order.
 *
 * Home is always first and always `/`, because the exported `App.tsx` falls
 * back to the first page for an unknown path — so the first page is the one a
 * visitor lands on when a route is wrong, and that had better be the home
 * page rather than the pricing table.
 */
export type SiteMap = readonly [typeof HOME, ...Destination[]];

export function siteMap(...rest: Destination[]): SiteMap {
  return [HOME, ...rest];
}

/** A destination by path, for a page that wants to know its own place. */
export function findDestination(map: SiteMap, path: string): Destination | undefined {
  return map.find((destination) => destination.path === path);
}
