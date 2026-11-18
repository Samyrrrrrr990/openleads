import { useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { publishSite, saveProject, siteInfo } from '../../core/persistence/repository';
import { Button } from '../../ui/controls';

/**
 * The agency end of the editor: open the live demo page, publish it.
 *
 * "Open site" is the page a lead would see (served by OpenLeads at /s/<slug>/).
 * Publish writes the static folder and, with a Netlify token, deploys it; the
 * resulting link is what `{{site_url}}` puts in emails.
 */
export function SiteActions(): React.ReactElement | null {
  const project = useProjectStore((s) => s.project);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null);
  if (!project) return null;
  const info = siteInfo(project.id);
  const preview = info ? info.preview : null;

  const publish = async () => {
    setBusy(true);
    setNote(null);
    try {
      await saveProject(project);
      const out = await publishSite(project.id);
      setNote(
        out.url
          ? { text: out.deployed ? 'Live at' : 'Link', href: out.url }
          : { text: `Saved to ${out.folder}. Add a Netlify token or site address in OpenLeads Settings for a public link.` },
      );
    } catch (caught) {
      setNote({ text: caught instanceof Error ? caught.message : 'Could not publish.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {note && (
        <span
          role="status"
          style={{ fontSize: 12, color: 'var(--text-muted, inherit)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={note.href ?? note.text}
        >
          {note.text}{' '}
          {note.href && (
            <a href={note.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
              {note.href.replace(/^https?:\/\//, '')}
            </a>
          )}
        </span>
      )}
      {preview && (
        <Button
          variant="default"
          onClick={() => {
            void saveProject(project).finally(() => window.open(preview, '_blank', 'noopener'));
          }}
        >
          Open site
        </Button>
      )}
      <Button variant="default" onClick={() => void publish()} disabled={busy}>
        {busy ? 'Publishing…' : 'Publish'}
      </Button>
    </>
  );
}
