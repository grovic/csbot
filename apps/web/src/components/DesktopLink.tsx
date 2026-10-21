// "Get the desktop app": the installer on GitHub Releases (unsigned beta, auto-updates).

export const DESKTOP_DOWNLOAD = 'https://github.com/grovic/csbot/releases/latest';

export function DesktopLink({ children = 'Get the desktop app' }: { children?: React.ReactNode }) {
  return (
    <a className="desktop-link" href={DESKTOP_DOWNLOAD} target="_blank" rel="noreferrer" data-testid="get-desktop">{children}</a>
  );
}
