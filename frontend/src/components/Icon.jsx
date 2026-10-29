// Small, consistent, monochrome icon set (inherits color via currentColor — no emoji, no
// platform-dependent colour glyphs). Replaces the earlier Unicode-symbol icons, which some
// operating systems render as full-colour emoji instead of plain glyphs.
const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  users: <><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="8.5" cy="7.5" r="3.25" /><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35" /><path d="M15 4.2a3.25 3.25 0 0 1 0 6.1" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /></>,
  list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3.5" y1="6" x2="3.5" y2="6" /><line x1="3.5" y1="12" x2="3.5" y2="12" /><line x1="3.5" y1="18" x2="3.5" y2="18" /></>,
  shield: <path d="M12 21s7-3.5 7-9.5V5.2L12 2.5 5 5.2v6.3C5 17.5 12 21 12 21Z" />,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6 8.5 7 8.5-7" /></>,
  layers: <><polygon points="12 3 3 8 12 13 21 8 12 3" /><polyline points="3 15.5 12 20.5 21 15.5" /><polyline points="3 11.5 12 16.5 21 11.5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4s1.2-1 4-1 4 2 7 2 4-1 4-1v9s-1.2 1-4 1-4-2-7-2-4 1-4 1" /></>,
  send: <><line x1="21" y1="3" x2="10" y2="14" /><polygon points="21 3 14 21 10 14 3 10 21 3" /></>,
  'bar-chart': <><line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="18" y1="20" x2="18" y2="16" /></>,
  activity: <polyline points="22 12 18.5 12 15.5 20 9 4 6 12 2 12" />,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2.1 2.1 0 1 1-3 3l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2.1 2.1 0 0 1-4.2 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2.1 2.1 0 1 1-3-3l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2.1 2.1 0 0 1 0-4.2h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2.1 2.1 0 1 1 3-3l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2.1 2.1 0 0 1 4.2 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2.1 2.1 0 1 1 3 3l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2.1 2.1 0 0 1 0 4.2h-.2a1.7 1.7 0 0 0-1.4 1.3Z" /></>,
  bell: <><path d="M6.5 9.2a5.5 5.5 0 0 1 11 0c0 6.1 2.3 7.8 2.3 7.8H4.2s2.3-1.7 2.3-7.8Z" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>,
  'chevron-right': <polyline points="9 6 15 12 9 18" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  'log-out': <><path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" /><polyline points="15.5 16.5 20 12 15.5 7.5" /><line x1="20" y1="12" x2="9" y2="12" /></>,
  camera: <><path d="M20.5 19H3.5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 3.5 7H7l1.6-2.4A1.5 1.5 0 0 1 9.85 4h4.3a1.5 1.5 0 0 1 1.25.6L16.8 7h3.7a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5Z" /><circle cx="12" cy="13" r="3.6" /></>,
  calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><line x1="15.5" y1="2.5" x2="15.5" y2="6.5" /><line x1="8.5" y1="2.5" x2="8.5" y2="6.5" /><line x1="3.5" y1="10" x2="20.5" y2="10" /></>,
  'thumbs-up': <path d="M7 11.5v9H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 11.5h2Zm0 0 3.2-6.8a2 2 0 0 1 2-1.1 1.9 1.9 0 0 1 1.8 2.5L13 9h5.3a2 2 0 0 1 2 2.3l-1 6.5a2 2 0 0 1-2 1.7H9a2 2 0 0 1-2-2v-6Z" />,
  'thumbs-down': <path d="M17 12.5v-9h2a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-2Zm0 0-3.2 6.8a2 2 0 0 1-2 1.1 1.9 1.9 0 0 1-1.8-2.5L11 15H5.7a2 2 0 0 1-2-2.3l1-6.5a2 2 0 0 1 2-1.7H15a2 2 0 0 1 2 2v6Z" />,
  meh: <><circle cx="12" cy="12" r="9" /><line x1="8.5" y1="15" x2="15.5" y2="15" /><line x1="9" y1="9.2" x2="9.01" y2="9.2" /><line x1="15" y1="9.2" x2="15.01" y2="9.2" /></>,
  'edit-pencil': <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5L16.5 3.5Z" />,
  'user-check': <><path d="M15 20.5v-1.3a3.5 3.5 0 0 0-3.5-3.5H6A3.5 3.5 0 0 0 2.5 19.2v1.3" /><circle cx="8.5" cy="8" r="3.25" /><polyline points="16 11.5 18 13.5 21.5 9.5" /></>,
  star: <polygon points="12 2.5 14.9 8.4 21.4 9.3 16.7 13.9 17.8 20.4 12 17.3 6.2 20.4 7.3 13.9 2.6 9.3 9.1 8.4 12 2.5" />,
  'dots-vertical': <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,
  download: <><path d="M12 3.5v11" /><polyline points="7.5 10.5 12 15 16.5 10.5" /><path d="M4.5 17.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" /></>,
  search: <><circle cx="11" cy="11" r="7.2" /><line x1="21" y1="21" x2="16.2" y2="16.2" /></>,
}

export default function Icon({ name, size = 16, strokeWidth = 1.8, className = '' }) {
  const body = PATHS[name]
  if (!body) return null
  return (
    <svg
      className={'icon ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  )
}
