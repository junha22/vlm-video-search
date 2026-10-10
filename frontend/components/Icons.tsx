import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

export const IconDashboard = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconSettings = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconYoutube = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="m10 9 5 3-5 3z" fill="currentColor" />
  </svg>
);

export const IconUpload = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

export const IconFilm = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
  </svg>
);

export const IconTrash = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.6} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconSend = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const IconSparkles = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9.94 14.06 8 20l-1.94-5.94L0 12l6.06-1.94L8 4l1.94 6.06L16 12z" transform="translate(2 -1) scale(.9)" />
    <path d="M19 3v4M17 5h4M20 16v3M18.5 17.5h3" />
  </svg>
);

export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" />
  </svg>
);

export const IconDownload = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const IconThumbUp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />
  </svg>
);

export const IconThumbDown = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" />
  </svg>
);

export const IconChevronDown = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconMinus = ({ size, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M5 12h14" />
  </svg>
);

export const IconPlus = ({ size, ...p }: P) => (
  <svg {...base(size)} strokeWidth={2.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconRefresh = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </svg>
);

export const IconCpu = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </svg>
);

export const IconActivity = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const IconX = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconEdit = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const IconScissors = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </svg>
);

export const IconLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="lg1" x1="0" y1="0" x2="32" y2="32">
        <stop offset="0" stopColor="#22d3ee" />
        <stop offset=".5" stopColor="#6d6af8" />
        <stop offset="1" stopColor="#c084fc" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#lg1)" />
    <path d="M12 9.5v13l10-6.5z" fill="#fff" />
    <path d="M8 8v16" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
    <path d="M24.5 8v16" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
  </svg>
);
