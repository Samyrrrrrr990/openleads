/**
 * The last thing between a thrown render and a white page.
 *
 * There was no error boundary anywhere in the application. A component that
 * threw took React's whole tree down with it, leaving a blank document and no
 * record that anything had happened — the failure was visible only in one
 * person's console, on one device, and only if they opened it. For a local-first
 * editor that is worse than it sounds: the work is safe in IndexedDB, but
 * somebody looking at a white screen has no way to know that.
 *
 * So this does two things, in order of importance to the person in front of it:
 *
 *   says the work is still there, because that is the actual question
 *   offers a way back that is not "refresh and hope"
 *
 * It deliberately does not try to recover the subtree automatically. A render
 * that threw once will usually throw again on the same state, and a boundary
 * that retries in a loop is how a broken component becomes a hot CPU.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /** Names the area that failed, so the message can be specific. */
  area?: string;
  /** Rendered instead of the default panel, when a caller wants its own. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * Reported to the console, deliberately and not conditionally.
     *
     * There is no error-reporting service wired up yet, and pretending
     * otherwise would be worse than this: a `console.error` in production is at
     * least something a user can copy into a bug report, and something a
     * `read_console_messages` call during testing can see. When a reporter is
     * added, it goes here — one call, in one place, already receiving the
     * component stack.
     */
    console.error('[zory:crash]', this.props.area ?? 'app', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className={styles.panel} role="alert">
        <h2 className={styles.title}>Something in {this.props.area ?? 'Studio'} stopped working</h2>
        <p className={styles.body}>
          Your projects are stored on this device and none of them were touched by this. Reloading
          is safe.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            Reload
          </button>
          <button type="button" className={styles.ghost} onClick={this.reset}>
            Try again
          </button>
        </div>
        {/*
          The message, shown rather than hidden behind a "details" link nobody
          opens. It is the only thing that makes a bug report actionable, and
          hiding it protects nobody — the person has already lost their screen.
        */}
        <pre className={styles.detail}>{error.message}</pre>
      </div>
    );
  }
}
