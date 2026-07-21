type IconName =
  | "arrow-left"
  | "arrow-right"
  | "channels"
  | "close"
  | "expand"
  | "play"
  | "search";

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
    close: (
      <>
        <path d="m7 7 10 10" />
        <path d="m17 7-10 10" />
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
    play: <path d="m9 7 8 5-8 5Z" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
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
