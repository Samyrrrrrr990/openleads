/**
 * The project dashboard.
 *
 * No account, no sync: this lists what is in this browser. The starter picker
 * sits above the list because creating is the common action on first visit,
 * and the empty state says plainly where projects live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ProjectSummary } from '@zory/core';
import {
  createProjectRecord,
  deleteProject,
  duplicateProject,
  listProjects,
  renameProject,
  setPendingLead,
} from '../core/persistence/repository';
import { CATEGORY_LABEL, buildProject, findStarter, type Starter, type TemplateCategory } from '../starters';
import { personalisedProject, type StarterChoices } from '../starters/personalise';
import { TemplateSetup } from './TemplateSetup';
import { TemplateThumb } from './TemplateThumb';
import { useDialogFocus } from '../ui/useDialogFocus';
import {
  deleteTemplate,
  listTemplates,
  projectFromTemplate,
  saveTemplate,
  templateIsOpenable,
  type TemplateSummary,
} from '../core/library/templates';
import { createProjectRecord as saveLocally } from '../core/persistence/repository';
import { loadProject } from '../core/persistence/repository';
import { useTeamStore } from '../core/team/store';
import { listShared, pullShared, pushShared, type SharedProject } from '../core/team/projects';
import { useAuthStore } from '../core/auth/authStore';
import { isAuthConfigured } from '../core/auth/config';
import { Button, IconButton } from '../ui/controls';
import { UpgradeNote, useBlocked } from '../ui/UpgradeNote';
import { useBillingStore } from '../core/billing/store';
import { limits, withinLimit } from '@zory/core';
import {
  CopyIcon,
  LayersIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  ZoryMark,
} from '../ui/icons';
import { track } from '../core/analytics/analytics';
import styles from './Projects.module.css';

/** The starter the marketing demo opens: finished enough to feel real. */
const DEMO_STARTER_ID = 'cadence';

/** Group order. Products first, because most people arrive wanting one. */
const CATEGORY_ORDER: TemplateCategory[] = ['product', 'portfolio', 'local', 'other'];

interface LeadBrief {
  email: string;
  business: string;
  city: string;
  industry: string;
}

export function ProjectsPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const demoStarted = useRef(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);

  /*
   * Which tab is showing.
   *
   * Defaults to projects, and to templates only for somebody who has none —
   * an empty "Your projects" is a dead end, and the reason they are here is to
   * start something. Once they have a project, that is what they came back for.
   */
  /*
   * Which tab is showing.
   *
   * Always starts on projects, including for somebody who has none. An earlier
   * version opened on templates when the list was empty, which sounds helpful
   * and was not: the dashboard stopped being predictable, and the primary
   * "start from nothing" action ended up behind a tab. The empty state below
   * points at templates instead, which does the same job without moving the
   * furniture.
   */
  const [tab, setTab] = useState<'projects' | 'templates'>('projects');

  /**
   * Narrowing the catalogue.
   *
   * Two dozen templates in four groups is a page you scroll rather than a set
   * you choose from. A search box and four chips are the smallest thing that
   * turns it back into choosing — and both are transient, deliberately: a
   * filter that survives a reload leaves somebody staring at an apparently
   * empty catalogue with no memory of why.
   */
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');

  /** The template whose set-up step is open, if any. */
  const [setupFor, setSetupFor] = useState<Starter | null>(null);

  /*
   * Building for a lead: OpenLeads opens Studio at `?lead=<email>`. The new site
   * belongs to that lead, starts with their business name, and the catalogue
   * opens on local-business templates.
   */
  const [lead, setLead] = useState<LeadBrief | null>(null);
  useEffect(() => {
    const email = search.get('lead');
    if (!email) return;
    setPendingLead(email);
    setTab('templates');
    setCategory('local');
    fetch(`/api/sites/lead?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: LeadBrief | null) => setLead(b ?? { email, business: '', city: '', industry: '' }))
      .catch(() => setLead({ email, business: '', city: '', industry: '' }));
  }, [search]);

  /*
   * Saving your own template is a Pro capability that Free could use in full.
   *
   * The affordance is removed rather than disabled: a button that opens a
   * price list where a person expected their project to be saved is a worse
   * interaction than the button not being there, and the templates panel
   * explains what is missing in the place somebody would look for it.
   *
   * Zory's own templates stay open to everybody. The gate is on making them,
   * never on using them, because a starter is how somebody finds out whether
   * this tool is any good.
   */
  const templatesBlocked = useBlocked('custom-templates');

  /*
   * The catalogue, and how much room there is to use it.
   *
   * Both are the free plan's actual shape. Premium templates are listed for
   * everybody and openable by subscribers; the project limit counts every
   * project, not only the synced ones, because a cap that local projects walk
   * around is not a cap.
   */
  const premiumBlocked = useBlocked('premium-templates');
  const entitlements = useBillingStore((s) => s.entitlements);
  const projectCap = limits(entitlements).projects;
  const atProjectCap = projects !== null && !withinLimit(projectCap, projects.length);
  const lockedCount = (templates ?? []).filter((template) => template.locked).length;

  /**
   * Matched on name, kind and description — the three things somebody types.
   *
   * "restaurant" is in a description rather than a name, and a search that
   * only reads names would answer an obvious query with nothing.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (templates ?? []).filter((template) => {
      if (category !== 'all' && template.category !== category) return false;
      if (needle === '') return true;
      return `${template.name} ${template.kind} ${template.description}`
        .toLowerCase()
        .includes(needle);
    });
  }, [templates, query, category]);

  const onTabKey = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // Two tabs, so either arrow is "the other one".
    setTab((current) => (current === 'projects' ? 'templates' : 'projects'));
  }, []);
  const [shared, setShared] = useState<SharedProject[] | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  const workspace = useTeamStore((s) => s.workspace);
  const refreshTeam = useTeamStore((s) => s.refresh);
  const user = useAuthStore((s) => s.user);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setTemplates(await listTemplates(!premiumBlocked));
      setError(null);
    } catch {
      setError(
        'Studio could not reach your OpenLeads workspace. Check that OpenLeads is still running, then reload.',
      );
      setProjects([]);
    }
  }, [premiumBlocked]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (user) void refreshTeam();
  }, [user, refreshTeam]);

  /** Shared projects are a separate fetch: they live in the workspace, not here. */
  const refreshShared = useCallback(async () => {
    if (!workspace) {
      setShared(null);
      return;
    }
    try {
      setShared(await listShared(workspace.id));
    } catch {
      // Cloud storage not provisioned, or offline. The local list is unaffected
      // and saying so on a dashboard would be noise.
      setShared([]);
    }
  }, [workspace]);

  useEffect(() => {
    void refreshShared();
  }, [refreshShared]);

  /** Copies a shared project into this browser and opens it. */
  const openShared = useCallback(
    async (summary: SharedProject) => {
      if (!workspace) return;
      setCreating(summary.id);
      try {
        const project = await pullShared(workspace.id, summary.id);
        if (!project) throw new Error('That project is no longer in the workspace.');
        await saveLocally(project, null);
        navigate(`/app/project/${project.id}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open that project.');
        setCreating(null);
      }
    },
    [navigate, workspace],
  );

  /** Publishes a local project into the workspace for everybody else. */
  const shareProject = useCallback(
    async (summary: ProjectSummary) => {
      if (!workspace || !user) return;
      setSharing(summary.id);
      try {
        const project = await loadProject(summary.id);
        if (!project) throw new Error('That project is not on this device.');
        await pushShared(workspace.id, project, {
          uid: user.uid,
          name: user.displayName ?? user.email ?? null,
        });
        await refreshShared();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not share that project.');
      } finally {
        setSharing(null);
      }
    },
    [workspace, user, refreshShared],
  );


  const create = useCallback(
    async (starterId: string | null) => {
      if (atProjectCap) return;
      setCreating(starterId ?? 'blank');
      setError(null);
      try {
        const project = buildProject(starterId);
        await createProjectRecord(project, starterId);
        navigate(`/app/project/${project.id}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not create that project.');
        setCreating(null);
      }
    },
    [navigate, atProjectCap],
  );

  /**
   * Picking a Zory template opens the set-up step; picking your own opens it.
   *
   * The difference is that a personal template is already yours — you saved it
   * from a project you had already named and coloured — so asking for a name
   * and a palette would be asking again about decisions you made when you
   * saved it.
   */
  const createFromTemplate = useCallback(
    async (template: TemplateSummary) => {
      // Checked again here, not only where the tile is drawn.
      if (!templateIsOpenable(template.id, !premiumBlocked)) return;
      if (atProjectCap) return;

      if (template.origin === 'zory') {
        const starter = findStarter(template.id);
        if (starter) {
          setSetupFor(starter);
          return;
        }
      }

      setCreating(template.id);
      setError(null);
      try {
        const project = await projectFromTemplate(template);
        await createProjectRecord(project, template.origin === 'zory' ? template.id : null);
        navigate(`/app/project/${project.id}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open that template.');
        setCreating(null);
      }
    },
    [navigate, premiumBlocked, atProjectCap],
  );

  /** The set-up step's Create, which is the only place choices are applied. */
  const createConfigured = useCallback(
    async (starter: Starter, choices: StarterChoices) => {
      if (atProjectCap) return;
      setCreating(starter.id);
      setError(null);
      try {
        const project = personalisedProject(starter, choices);
        await createProjectRecord(project, starter.id);
        navigate(`/app/project/${project.id}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open that template.');
        setCreating(null);
        setSetupFor(null);
      }
    },
    [navigate, atProjectCap],
  );

  const keepAsTemplate = useCallback(
    async (summary: ProjectSummary) => {
      // Checked again here, not only where the button is drawn. A gate that
      // lives solely in the render is a gate that a stale prop can walk past.
      if (templatesBlocked) {
        setTab('templates');
        return;
      }
      try {
        const project = await loadProject(summary.id);
        if (!project) return;
        await saveTemplate(project);
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not keep that as a template.');
      }
    },
    [refresh, templatesBlocked],
  );

  /**
   * `/demo` lands here with `?demo=1`. Rather than showing a chooser, open a
   * finished starter straight away — the fastest honest path from "curious"
   * to "editing something real" is not a menu.
   *
   * It fires once, and never for someone who already has work here.
   */
  useEffect(() => {
    if (search.get('demo') !== '1' || projects === null || demoStarted.current) return;
    demoStarted.current = true;
    setSearch({}, { replace: true });

    /*
     * Reaching a real editor, which is the step the funnel turns on. Recorded
     * whether or not a starter is opened: somebody arriving here with projects
     * already reached the product, they simply kept their own work.
     */
    track('demo_opened', { hadProjects: projects.length > 0 });

    if (projects.length === 0) void create(DEMO_STARTER_ID);
  }, [search, projects, setSearch, create]);

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <a href="/#/sites" className={styles.brand} title="Back to OpenLeads">
          <span className={styles.brandMark}>
            <ZoryMark size={17} />
          </span>
          Studio
        </a>
        <span className={styles.spacer} />
        <a href="/#/sites" className={styles.codeLink}>
          Back to OpenLeads
        </a>
        <Button
          variant="primary"
          onClick={() => void create(null)}
          disabled={creating !== null || atProjectCap}
          title={atProjectCap ? `Free keeps ${projectCap} projects. Pro is unlimited.` : undefined}
        >
          <PlusIcon size={12} />
          New project
        </Button>
      </header>

      <main className={styles.main}>
        {lead && (
          <div
            role="status"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 20,
              fontSize: 13,
              lineHeight: 1.5,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ flex: 1, minWidth: 220 }}>
              Building a site for <strong>{lead.business || lead.email}</strong>
              {lead.city ? ` in ${lead.city}` : ''}. Pick a template: it starts with their name,
              and the site is linked to them, so <code>{'{{site_url}}'}</code> in your emails
              links to it.
            </span>
            <button
              type="button"
              onClick={() => {
                setPendingLead('');
                setLead(null);
                setSearch({}, { replace: true });
              }}
              style={{ fontSize: 12, textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
            >
              Not for a lead
            </button>
          </div>
        )}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Projects</h1>
            <p className={styles.subtitle}>
              Sites are saved in your OpenLeads workspace on this machine. Each one gets a
              preview link you can send to the business it was built for.
            </p>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Dashboard">
          <button
            type="button"
            role="tab"
            id="tab-projects"
            aria-selected={tab === 'projects'}
            aria-controls="panel-projects"
            tabIndex={tab === 'projects' ? 0 : -1}
            className={`${styles.tab} ${tab === 'projects' ? styles.tabActive : ''}`}
            onClick={() => setTab('projects')}
            onKeyDown={onTabKey}
          >
            Your projects
            {projects && projects.length > 0 ? (
              <span className={styles.tabCount}>{projects.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            id="tab-templates"
            aria-selected={tab === 'templates'}
            aria-controls="panel-templates"
            tabIndex={tab === 'templates' ? 0 : -1}
            className={`${styles.tab} ${tab === 'templates' ? styles.tabActive : ''}`}
            onClick={() => setTab('templates')}
            onKeyDown={onTabKey}
          >
            Templates
            {templates ? <span className={styles.tabCount}>{templates.length}</span> : null}
          </button>
        </div>

        <div
          id="panel-templates"
          role="tabpanel"
          aria-labelledby="tab-templates"
          hidden={tab !== 'templates'}
          className={styles.panel}
        >
          <p className={styles.panelLede}>
            Every template is a real project: open one, change anything, and export it as React and
            TypeScript. They are built from the same design tokens the editor exposes, so changing
            the accent restyles the whole thing.
          </p>

          {/*
            Said before somebody picks a template, not after.
            
            The cap is on projects rather than on opening, so discovering it at
            the moment of clicking a tile you liked is the worst possible
            place: the person has already chosen. This is the same information
            one step earlier.
          */}
          {atProjectCap ? (
            <UpgradeNote
              feature="private-projects"
              title={`You have ${projectCap} of ${projectCap} projects`}
              body="Delete one to start something new, or move to Pro for as many as you like. Nothing you have built is touched either way, and every project still exports."
            />
          ) : null}

          {premiumBlocked ? (
            <UpgradeNote
              feature="premium-templates"
              title="The rest of the bank"
              body={`Six templates are open on Free. The other ${lockedCount} — analytics products, architecture studios, restaurants, fashion labels — come with Pro, along with your own saved templates.`}
            />
          ) : templatesBlocked ? (
            <UpgradeNote
              feature="custom-templates"
              title="Keep your own work as a template"
              body="Finish a project once, then start every future one from it — your layout, your type scale, your tokens."
            />
          ) : null}

          <div className={styles.filters}>
            <label className={styles.searchField}>
              <span className="sr-only">Search templates</span>
              <SearchIcon size={13} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search templates"
                className={styles.searchInput}
                autoComplete="off"
              />
            </label>

            <div className={styles.chips} role="group" aria-label="Filter by kind">
              {(['all', ...CATEGORY_ORDER] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.chip} ${category === option ? styles.chipOn : ''}`}
                  aria-pressed={category === option}
                  onClick={() => setCategory(option)}
                >
                  {option === 'all' ? 'Everything' : CATEGORY_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          {templates !== null && shown.length === 0 ? (
            <p className={styles.noMatch} role="status">
              Nothing matches {query.trim() === '' ? 'that filter' : `“${query.trim()}”`}.{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                Show everything
              </button>
            </p>
          ) : null}

          {CATEGORY_ORDER.map((bucket) => {
            const group = shown.filter((template) => template.category === bucket);
            if (group.length === 0) return null;

            return (
              <section
                key={bucket}
                className={styles.group}
                aria-labelledby={`group-${bucket}`}
              >
                <div className={styles.groupHead}>
                  <h3 id={`group-${bucket}`} className={styles.groupTitle}>
                    {CATEGORY_LABEL[bucket]}
                  </h3>
                  <span className={styles.groupCount}>{group.length}</span>
                </div>
                <div className={styles.starters}>
              {group.map((template) => (
                <div key={template.id} className={styles.starterWrap}>
                  <button
                    type="button"
                    className={`${styles.starter} ${template.locked ? styles.starterLocked : ''}`}
                    onClick={() => void createFromTemplate(template)}
                    disabled={creating !== null || template.locked || atProjectCap}
                    title={
                      template.locked
                        ? `${template.name} is on Pro — ${template.description}`
                        : template.description
                    }
                  >
                    <div className={styles.starterPreview}>
                      <TemplateThumb
                        bands={template.bands}
                        swatches={template.swatches}
                        surface={template.surface}
                        border={template.border}
                        name={template.name}
                      />
                      {/*
                        Shown, not hidden.
                        
                        Removing premium tiles from the grid would be the
                        obvious implementation and the wrong one: the catalogue
                        is the reason to pay, and a reason nobody can see is
                        not one. A locked tile is an argument for the plan; an
                        absent tile is nothing at all.
                      */}
                      {template.locked ? (
                        <span className={styles.starterLock} aria-hidden="true">
                          <LockIcon size={11} />
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.starterMeta}>
                      <span className={styles.starterName}>{template.name}</span>
                      <span className={styles.starterKind}>
                        <span className={styles.starterKindText}>{template.kind}</span>
                        <span className={styles.starterDot} aria-hidden="true">
                          ·
                        </span>
                        <span>
                          {template.pageCount} {template.pageCount === 1 ? 'page' : 'pages'}
                        </span>
                        {template.locked ? <span className={styles.starterPro}>Pro</span> : null}
                      </span>
                    </div>
                  </button>
                  {template.origin === 'personal' ? (
                    <button
                      type="button"
                      className={styles.starterRemove}
                      aria-label={`Remove the ${template.name} template`}
                      onClick={async () => {
                        await deleteTemplate(template.id);
                        await refresh();
                      }}
                    >
                      <TrashIcon size={11} />
                    </button>
                  ) : null}
                </div>
              ))}
                </div>
              </section>
            );
          })}
        </div>

        <div
          id="panel-projects"
          role="tabpanel"
          aria-labelledby="tab-projects"
          hidden={tab !== 'projects'}
          className={styles.panel}
        >
          <div className={styles.starters}>
            <button
              type="button"
              className={`${styles.starter} ${styles.starterBlank}`}
              onClick={() => void create(null)}
              disabled={creating !== null}
            >
              <div className={styles.starterPreview}>
                <PlusIcon size={18} />
              </div>
              <div className={styles.starterMeta}>
                <span className={styles.starterName}>Blank project</span>
                <span className={styles.starterKind}>Start from an empty page</span>
              </div>
            </button>
            <button
              type="button"
              className={`${styles.starter} ${styles.starterBlank}`}
              onClick={() => setTab('templates')}
            >
              <div className={styles.starterPreview}>
                <LayersIcon size={18} />
              </div>
              <div className={styles.starterMeta}>
                <span className={styles.starterName}>Start from a template</span>
                <span className={styles.starterKind}>
                  {templates ? `${templates.length} to choose from` : 'Finished pages to edit'}
                </span>
              </div>
            </button>
          </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {workspace ? (
          <section aria-labelledby="shared-heading" className={styles.sharedSection}>
            <div className={styles.listHead}>
              <h2 id="shared-heading" className={styles.listTitle}>
                {workspace.name}
              </h2>
              {shared && shared.length > 0 ? (
                <span className={styles.listCount}>
                  {shared.length} shared {shared.length === 1 ? 'project' : 'projects'}
                </span>
              ) : null}
            </div>

            {shared === null ? null : shared.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>Nothing shared yet</p>
                <p className={styles.emptyBody}>
                  Share one of your projects below and everybody in {workspace.name} can open it.
                  Opening a shared project copies it to this browser; saving pushes it back.
                </p>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {shared.map((project) => (
                  <li key={project.id}>
                    <div className={styles.row}>
                      <button
                        type="button"
                        className={styles.rowMain}
                        style={{ textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
                        disabled={creating !== null}
                        onClick={() => void openShared(project)}
                      >
                        <span className={styles.rowName}>{project.name}</span>
                        <span className={styles.rowMeta}>
                          <span>Edited {formatRelative(project.updatedAt)}</span>
                          {project.updatedByName ? (
                            <>
                              <span className={styles.rowDot}>·</span>
                              <span>by {project.updatedByName}</span>
                            </>
                          ) : null}
                          <span className={styles.rowDot}>·</span>
                          <span>
                            {project.nodeCount} {project.nodeCount === 1 ? 'element' : 'elements'}
                          </span>
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section aria-labelledby="recent-heading">
          <div className={styles.listHead}>
            <h2 id="recent-heading" className={styles.listTitle}>
              Your projects
            </h2>
            {projects && projects.length > 0 && (
              <span className={styles.listCount}>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            )}
          </div>

          {projects === null ? (
            /*
              `role="status"` is what makes the label legal.
              
              `aria-label` on a bare <div> is prohibited by ARIA — a generic
              element exposes no role for the name to attach to, so the name is
              simply dropped and a screen reader announces nothing at all. The
              status role is also the honest one for this: it is a polite live
              region, so the skeleton being replaced by the list is announced
              rather than happening in silence.
            */
            <div role="status" aria-busy="true" aria-label="Loading projects">
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No projects yet</p>
              <p className={styles.emptyBody}>
                Open a blank project and build from nothing, or{' '}
                <button type="button" className={styles.emptyLink} onClick={() => setTab('templates')}>
                  start from one of {templates?.length ?? 20} templates
                </button>{' '}
                to see how Studio works on a finished page.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {projects.map((project) => (
                <li key={project.id}>
                  <ProjectRow
                    project={project}
                    renaming={renamingId === project.id}
                    onStartRename={() => setRenamingId(project.id)}
                    onFinishRename={async (name) => {
                      setRenamingId(null);
                      if (name && name !== project.name) {
                        await renameProject(project.id, name);
                        await refresh();
                      }
                    }}
                    onDuplicate={async () => {
                      await duplicateProject(project.id);
                      await refresh();
                    }}
                    {...(templatesBlocked
                      ? {}
                      : { onKeepAsTemplate: () => void keepAsTemplate(project) })}
                    {...(workspace
                      ? {
                          onShare: () => void shareProject(project),
                          sharing: sharing === project.id,
                          workspaceName: workspace.name,
                        }
                      : {})}
                    onDelete={() => setPendingDelete(project)}
                  />
                </li>
              ))}
            </ul>
          )}
          </section>
        </div>
      </main>

      {setupFor && (
        <TemplateSetup
          initialName={lead?.business || undefined}
          starter={setupFor}
          busy={creating === setupFor.id}
          onCancel={() => setSetupFor(null)}
          onCreate={(choices) => void createConfigured(setupFor, choices)}
        />
      )}

      {pendingDelete && (
        <ConfirmDelete
          project={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await deleteProject(pendingDelete.id);
            setPendingDelete(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ProjectRow({
  project,
  renaming,
  onStartRename,
  onFinishRename,
  onDuplicate,
  onKeepAsTemplate,
  onShare,
  sharing,
  workspaceName,
  onDelete,
}: {
  project: ProjectSummary;
  renaming: boolean;
  onStartRename: () => void;
  onFinishRename: (name: string | null) => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  /** Absent when the plan does not include saving your own templates. */
  onKeepAsTemplate?: () => void;
  /** Only present when this account is in a workspace. */
  onShare?: () => void;
  sharing?: boolean;
  workspaceName?: string;
  onDelete: () => void;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  return (
    <div className={styles.row}>
      {renaming ? (
        <input
          ref={inputRef}
          className={styles.renameInput}
          defaultValue={project.name}
          aria-label={`Rename ${project.name}`}
          onBlur={(event) => void onFinishRename(event.target.value.trim() || null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = project.name;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <Link to={`/app/project/${project.id}`} className={styles.rowMain}>
          <span className={styles.rowName}>{project.name}</span>
          <span className={styles.rowMeta}>
            <span>Edited {formatRelative(project.updatedAt)}</span>
            <span className={styles.rowDot}>·</span>
            <span>
              {project.nodeCount} {project.nodeCount === 1 ? 'element' : 'elements'}
            </span>
          </span>
        </Link>
      )}

      <div className={styles.rowActions}>
        {onShare ? (
          <Button variant="ghost" disabled={sharing} onClick={onShare}>
            {sharing ? 'Sharing…' : `Share with ${workspaceName}`}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onStartRename}>
          Rename
        </Button>
        {onKeepAsTemplate ? (
          <IconButton label={`Keep ${project.name} as a template`} onClick={onKeepAsTemplate}>
            <LayersIcon />
          </IconButton>
        ) : null}
        <IconButton label={`Duplicate ${project.name}`} onClick={() => void onDuplicate()}>
          <CopyIcon />
        </IconButton>
        <IconButton label={`Delete ${project.name}`} onClick={onDelete}>
          <TrashIcon />
        </IconButton>
      </div>
    </div>
  );
}

function ConfirmDelete({
  project,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);

  /*
   * Focus lands on "Keep it" rather than the destructive button.
   *
   * This used to focus "Delete project", which put the irreversible action
   * one Enter away from a dialog somebody may not have finished reading. The
   * shared hook takes the first control, and the safe one is first in source
   * for exactly this reason. It also adds the Tab cycle and the focus return
   * this dialog never had.
   */
  useDialogFocus(panelRef, onCancel);

  return (
    <div
      className={styles.confirmScrim}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className={styles.confirm}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 id="confirm-title" className={styles.confirmTitle}>
          Delete {project.name}?
        </h2>
        <p id="confirm-body" className={styles.confirmBody}>
          This removes the site from your OpenLeads workspace. No copy is kept elsewhere, so this cannot
          be undone.
        </p>
        <div className={styles.confirmActions}>
          <Button onClick={onCancel}>Keep it</Button>
          <Button variant="danger" onClick={() => void onConfirm()}>
            Delete project
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "just now", "12 minutes ago", "3 days ago", then a date. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: new Date(timestamp).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}
