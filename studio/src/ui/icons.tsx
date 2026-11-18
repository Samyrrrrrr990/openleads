/**
 * Icons.
 *
 * A single hand-drawn set at one weight and one grid, so the chrome reads as
 * one system. All are 14×14 on a 14-unit grid with a 1.3 stroke.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 14, children, ...rest }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h6.2a2.8 2.8 0 010 5.6H6" />
    <path d="M5.4 3.4L2.8 6l2.6 2.6" />
  </Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 6H4.8a2.8 2.8 0 000 5.6H8" />
    <path d="M8.6 3.4L11.2 6 8.6 8.6" />
  </Icon>
);

export const DesktopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.5" y="2.5" width="11" height="7.5" rx="1" />
    <path d="M5 12.2h4" />
  </Icon>
);

export const TabletIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="1.5" width="8" height="11" rx="1.2" />
    <path d="M6.4 10.4h1.2" />
  </Icon>
);

export const MobileIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.2" y="1.5" width="5.6" height="11" rx="1.2" />
    <path d="M6.5 10.4h1" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 2.8l6.2 4.2-6.2 4.2z" fill="currentColor" strokeWidth="1" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 1.8v7" />
    <path d="M4.2 6.2L7 9l2.8-2.8" />
    <path d="M2 10.8v0.6a1 1 0 001 1h8a1 1 0 001-1v-0.6" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 1.4l1.35 3.3L11.6 6l-3.25 1.3L7 10.6 5.65 7.3 2.4 6l3.25-1.3z" />
    <path d="M11.2 9.6l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.2 2.8L9.4 7l-4.2 4.2" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 2.6v8.8M2.6 7h8.8" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 3.6h9.2" />
    <path d="M5.4 3.6V2.4h3.2v1.2" />
    <path d="M3.6 3.6l.5 7.4a1 1 0 001 .9h3.8a1 1 0 001-.9l.5-7.4" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.6" y="4.6" width="7.4" height="7.4" rx="1.1" />
    <path d="M9.4 2.2H3.1a1 1 0 00-1 1v6.3" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6.3" cy="6.3" r="3.7" />
    <path d="M9.1 9.1l2.9 2.9" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.4 3.4l7.2 7.2M10.6 3.4l-7.2 7.2" />
  </Icon>
);

export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 1.8L1.8 4.6 7 7.4l5.2-2.8z" />
    <path d="M1.8 7.6L7 10.4l5.2-2.8" />
    <path d="M1.8 10.2L7 13l5.2-2.8" />
  </Icon>
);

export const PagesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 1.8h5l3 3v7.4a1 1 0 01-1 1H3a1 1 0 01-1-1V2.8a1 1 0 011-1z" />
    <path d="M8 1.8v3h3" />
  </Icon>
);

export const InsertIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="1.8" width="10.4" height="10.4" rx="1.4" />
    <path d="M7 4.6v4.8M4.6 7h4.8" />
  </Icon>
);

export const AssetsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="2.6" width="10.4" height="8.8" rx="1.2" />
    <path d="M1.8 9.2l2.9-2.6 2.4 2.1 2-1.8 2.5 2.2" />
    <circle cx="5.1" cy="5.3" r="0.85" />
  </Icon>
);

/** A folder: the linked workspace on disk. */
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 3.6h3.4l1.2 1.5h5.8v5.3a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
  </Icon>
);

/** A plug: services you connect a project to. */
export const PlugIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.2 1.8v2.6M8.8 1.8v2.6" />
    <path d="M3.4 4.4h7.2v2.1a3.6 3.6 0 0 1-3.6 3.6 3.6 3.6 0 0 1-3.6-3.6z" />
    <path d="M7 10.1v2.1" />
  </Icon>
);

export const TextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3.4h8M7 3.4v7.2M5.4 10.6h3.2" />
  </Icon>
);

export const HeadingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.2 2.8v8.4M9.6 2.8v8.4M3.2 7h6.4" />
  </Icon>
);

export const BoxIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="2.6" width="10.4" height="8.8" rx="1.2" />
  </Icon>
);

export const ButtonIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.6" y="4.4" width="10.8" height="5.2" rx="2.2" />
  </Icon>
);

export const ImageIcon = AssetsIcon;

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.9 8.1a2.4 2.4 0 003.6.26l1.6-1.6a2.4 2.4 0 00-3.4-3.4l-.9.9" />
    <path d="M8.1 5.9a2.4 2.4 0 00-3.6-.26l-1.6 1.6a2.4 2.4 0 003.4 3.4l.9-.9" />
  </Icon>
);

export const DividerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 7h10" />
  </Icon>
);

/**
 * An instance: a filled diamond, the shape every design tool uses for "this is
 * a reference to something defined elsewhere".
 */
export const InstanceIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 2l5 5-5 5-5-5z" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.1A5.6 5.6 0 017 3c3 0 5.2 2.4 5.8 4-.3.75-.9 1.7-1.8 2.5" />
    <path d="M9.5 10.7A5.7 5.7 0 017 11c-3 0-5.2-2.4-5.8-4 .35-.9 1.15-2.1 2.4-2.95" />
    <path d="M2 2l10 10" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="2.1" />
    <path d="M7 1.4v1.3M7 11.3v1.3M12.6 7h-1.3M2.7 7H1.4M10.96 3.04l-.92.92M3.96 10.04l-.92.92M10.96 10.96l-.92-.92M3.96 3.96l-.92-.92" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.4" cy="4.8" r="2.1" />
    <path d="M1.8 11.8c0-2 1.6-3.3 3.6-3.3s3.6 1.3 3.6 3.3" />
    <path d="M9.6 3.1a2.1 2.1 0 010 3.7" />
    <path d="M10.6 8.9c1.1.4 1.9 1.4 1.9 2.9" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.6" y="6.2" width="8.8" height="5.6" rx="1.2" />
    <path d="M4.8 6.2V4.6a2.2 2.2 0 014.4 0v1.6" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 7h9.2M8 3.4L11.6 7 8 10.6" />
  </Icon>
);

/**
 * GitHub's mark.
 *
 * Drawn rather than pulled from an icon set, because it is a specific logo
 * rather than a generic glyph: a "code" icon in its place would be a different
 * claim. GitHub permits use of the mark to link to GitHub, which is the only
 * thing it does here.
 */
export const GitHubIcon = ({ size = 16, ...rest }: IconProps): React.ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

/** The OpenLeads mark: Studio is part of OpenLeads, so it wears the same logo. */
export const ZoryMark = ({ size = 18, ...rest }: IconProps): React.ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <rect width="32" height="32" rx="8" fill="var(--brand-mark, var(--accent))" />
    <path d="M8 8h16L8 24z" fill="#fff" />
  </svg>
);

export const BrandMark = ZoryMark;

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.6 7.4l2.9 2.9 5.9-6.6" />
  </Icon>
);
