import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

/*
 * OpenLeads Studio: the site dashboard and the editor. No marketing pages, no
 * accounts, no checkout. Projects are stored by your OpenLeads workspace, so a
 * site can belong to a lead and be previewed at /s/<slug>.
 */
const ProjectsPage = lazy(() => import('./ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const EditorShell = lazy(() => import('../editor/EditorShell').then((m) => ({ default: m.EditorShell })));

function RouteFallback(): React.ReactElement {
  return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} aria-busy="true" />;
}

export function App(): React.ReactElement {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/app/projects" element={<ProjectsPage />} />
        <Route path="/app/project/:id" element={<EditorShell />} />
        <Route path="*" element={<Navigate to="/app/projects" replace />} />
      </Routes>
    </Suspense>
  );
}
