type IconName =
  | "arrow-left"
  | "arrow-right"
  | "channels"
  | "collapse"
  | "expand"
  | "list"
  | "play"
  | "search"
  | "stop"
  | "volume"
  | "volume-off";

export function Icon({ name }: { name: IconName }): React.JSX.Element {
  const path = {
    "arrow-left": <path d="m15 18-6-6 6-6" />,
    "arrow-right": <path d="m9 18 6-6-6-6" />,
    channels: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m8 2 4 3 4-3" />
      </>
    ),
    collapse: (
      <>
        <path d="M9 9H4V4" />
        <path d="m4 9 5-5" />
        <path d="M15 9h5V4" />
        <path d="m20 9-5-5" />
        <path d="M9 15H4v5" />
        <path d="m4 15 5 5" />
        <path d="M15 15h5v5" />
        <path d="m20 15-5 5" />
      </>
    ),
    expand: (
      <>
        <path d="M8 3H3v5" />
        <path d="m3 3 6 6" />
        <path d="M16 3h5v5" />
        <path d="m21 3-6 6" />
        <path d="M8 21H3v-5" />
        <path d="m3 21 6-6" />
        <path d="M16 21h5v-5" />
        <path d="m21 21-6-6" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </>
    ),
    play: <path d="m9 7 8 5-8 5Z" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
    volume: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4Z" />
        <path d="M15.5 9.5a4 4 0 0 1 0 5" />
        <path d="M18.5 6.5a8 8 0 0 1 0 11" />
      </>
    ),
    "volume-off": (
      <>
        <path d="M11 5 6 9H3v6h3l5 4Z" />
        <path d="m16 10 5 5" />
        <path d="m21 10-5 5" />
      </>
    ),
  } satisfies Record<IconName, React.JSX.Element>;

  return (
    <svg aria-hidden="true" className="icon" fill="none" viewBox="0 0 24 24">
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {path[name]}
      </g>
    </svg>
  );
}
