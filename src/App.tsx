import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  useQueryStates,
  parseAsString,
} from "nuqs";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import {
  searchAppStore,
  searchBrew,
  searchNix,
  type AppStoreSearchResult,
  type BrewSearchResult,
  type NixKind,
  type NixSearchResult,
} from "./package-search";

const searchParsers = {
  q: parseAsString.withDefault(""),
};

type Theme = "dark" | "light";
type SourceFilter = "all" | "nix" | "brew" | "mas";

function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
}

function effectiveTheme(theme: Theme | null): Theme {
  return (
    theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

function faviconUrl(homepage: string): string | null {
  if (!homepage) return null;
  try {
    const domain = new URL(homepage).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return null;
  }
}

function nixKindLabel(kind: NixKind): string {
  if (kind === "package") return "nix package";
  if (kind === "option") return "nix option";
  return "nix service";
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function parseSourceFilter(rawQuery: string): {
  source: SourceFilter;
  searchTerm: string;
} {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { source: "all", searchTerm: "" };

  const match = trimmed.match(/^(nix|brew|mas):\s*(.*)$/i);
  if (match) {
    const [, source, searchTerm] = match;
    return {
      source: source.toLowerCase() as Exclude<SourceFilter, "all">,
      searchTerm: searchTerm.trim(),
    };
  }
  return { source: "all", searchTerm: trimmed };
}

function CopyButton({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : "Copy install command"}
      className={`shrink-0 inline-flex items-center justify-center px-2 py-1 border-[1.5px] rounded-md bg-transparent cursor-pointer transition-[border-color,color] duration-150 ${
        copied
          ? "border-success text-success"
          : "border-line text-fg hover:border-line-accent hover:text-accent"
      }`}
    >
      {copied ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2.25} />}
    </button>
  );
}

function CardWrapper({
  url,
  hoverBorderClass,
  ariaLabel,
  children,
}: {
  url: string;
  hoverBorderClass: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const open = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  const onClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("a, button")) return;
    open();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  return (
    <article
      tabIndex={0}
      role="link"
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`border-[1.5px] border-line rounded-lg py-[13px] px-4 bg-bg-base h-full flex flex-col cursor-pointer transition-[border-color,box-shadow] duration-150 hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-line-accent ${hoverBorderClass}`}
    >
      {children}
    </article>
  );
}

const cardTopClass = "flex items-center gap-2 mb-1.5 flex-nowrap overflow-hidden";
const cardMetaClass = "m-0 mb-[7px] text-[11px] leading-tight text-fg uppercase tracking-[0.06em] opacity-70";
const pkgDescClass = "m-0 mb-[9px] text-[13.5px] text-fg leading-[1.5] line-clamp-2";
const installRowClass = "flex items-center gap-[7px] mt-auto";
const installCmdClass = "flex-1 min-w-0 text-[12.5px] font-mono px-[11px] py-[5px] bg-code-bg text-fg-strong rounded-md whitespace-nowrap overflow-hidden text-ellipsis block";
const pkgFaviconClass = "w-4 h-4 rounded-[3px] object-contain shrink-0";
const pkgNameClass = "text-[15px] font-semibold text-fg-strong font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
const pkgNameAppClass = "text-[15px] font-semibold text-fg-strong flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";

function NixCard({ pkg }: { pkg: NixSearchResult }) {
  const fav = faviconUrl(pkg.homepage);
  return (
    <CardWrapper
      url={pkg.openUrl}
      hoverBorderClass="hover:border-line-accent"
      ariaLabel={`Open ${pkg.name} on Nix search`}
    >
      <div className={cardTopClass}>
        {fav && (
          <img
            className={pkgFaviconClass}
            src={fav}
            alt=""
            aria-hidden
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <span className={pkgNameClass} title={pkg.name}>
          {pkg.name}
        </span>
      </div>
      <p className={cardMetaClass}>
        {nixKindLabel(pkg.kind)}
        {pkg.version && <span className="ml-1.5 normal-case tracking-normal">{pkg.version}</span>}
      </p>
      {pkg.description && <p className={pkgDescClass}>{pkg.description}</p>}
      <div className={installRowClass}>
        <code className={installCmdClass}>{pkg.installCommand}</code>
        <CopyButton cmd={pkg.installCommand} />
      </div>
    </CardWrapper>
  );
}

function BrewCard({ pkg }: { pkg: BrewSearchResult }) {
  const fav = faviconUrl(pkg.homepage);
  return (
    <CardWrapper
      url={pkg.openUrl}
      hoverBorderClass="hover:border-brew-border"
      ariaLabel={`Open ${pkg.name} on Homebrew`}
    >
      <div className={cardTopClass}>
        {fav && (
          <img
            className={pkgFaviconClass}
            src={fav}
            alt=""
            aria-hidden
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <span className={pkgNameClass} title={pkg.name}>
          {pkg.name}
        </span>
      </div>
      <p className={cardMetaClass}>
        {pkg.brewType}
        {pkg.version && <span className="ml-1.5 normal-case tracking-normal">{pkg.version}</span>}
      </p>
      {pkg.description && <p className={pkgDescClass}>{pkg.description}</p>}
      <div className={installRowClass}>
        <code className={installCmdClass}>{pkg.installCommand}</code>
        <CopyButton cmd={pkg.installCommand} />
      </div>
    </CardWrapper>
  );
}

function AppStoreCard({ pkg }: { pkg: AppStoreSearchResult }) {
  const desc =
    pkg.description.length > 150
      ? pkg.description.slice(0, 150).trimEnd() + "…"
      : pkg.description;
  return (
    <CardWrapper
      url={pkg.openUrl}
      hoverBorderClass="hover:border-appstore-border"
      ariaLabel={`Open ${pkg.name} on App Store`}
    >
      <div className={cardTopClass}>
        {pkg.icon && (
          <img
            className="w-7 h-7 rounded-md object-contain shrink-0"
            src={pkg.icon}
            alt=""
            aria-hidden
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <span className={pkgNameAppClass} title={pkg.name}>
          {pkg.name}
        </span>
      </div>
      <p className={cardMetaClass}>
        app store
        {pkg.version && <span className="ml-1.5 normal-case tracking-normal">{pkg.version}</span>}
      </p>
      {pkg.sellerName && (
        <p className="m-0 mb-1 text-[12px] text-fg leading-[1.5] line-clamp-2 opacity-70">
          {pkg.sellerName}
        </p>
      )}
      {desc && <p className={pkgDescClass}>{desc}</p>}
      <div className={installRowClass}>
        <code className={installCmdClass}>{pkg.installCommand}</code>
        <CopyButton cmd={pkg.installCommand} />
      </div>
    </CardWrapper>
  );
}

function EcosystemSection({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 px-0.5">
        <img
          src={icon}
          alt=""
          aria-hidden
          className="w-[18px] h-[18px] object-contain shrink-0"
        />
        <h2 className="m-0 text-sm font-bold tracking-[0.02em] text-fg-strong">
          {label}
        </h2>
      </div>
      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(270px,1fr))] min-[960px]:grid-cols-3 max-[500px]:grid-cols-1">
        {children}
      </div>
    </section>
  );
}

function SearchInput({
  value,
  onChange,
  inputRef,
  name,
  autoFocus,
  className,
}: {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  name?: string;
  autoFocus?: boolean;
  className: string;
}) {
  const [draftValue, setDraftValue] = useState(value ?? "");
  const controlled = value !== undefined;
  const currentValue = controlled ? value : draftValue;

  useEffect(() => {
    if (controlled) setDraftValue(value);
  }, [controlled, value]);

  return (
    <input
      ref={inputRef}
      type="search"
      name={name}
      autoFocus={autoFocus}
      placeholder="Search packages… e.g. git, brew: git, nix: ffmpeg, mas: tailscale"
      autoComplete="off"
      spellCheck={false}
      value={currentValue}
      onChange={(e) => {
        if (!controlled) setDraftValue(e.target.value);
        onChange?.(e);
      }}
      className={className}
    />
  );
}

const statusMsgClass =
  "text-fg text-center py-12 text-[15px] m-0 opacity-70";
const statusMsgInlineClass =
  "text-fg text-center py-3 text-[13px] m-0 opacity-70";
const sectionLabelClass = "text-[13px] text-fg mt-0.5 mb-0 px-0.5";

function Landing() {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center px-4 -mt-16">
      <h1
        style={{ fontFamily: '"Monaspace Neon", ui-monospace, monospace' }}
        className="font-bold text-fg-strong text-4xl sm:text-5xl md:text-6xl tracking-[-0.04em] m-0 mb-8"
      >
        pkgs.one
      </h1>
      <form action="/search" method="get" className="w-full max-w-xl">
        <SearchInput
          name="q"
          autoFocus
          className="w-full px-4 py-3 text-base font-sans border border-line rounded-lg bg-bg-base text-fg-strong outline-none transition-colors duration-150 appearance-none focus:border-accent placeholder:text-fg placeholder:opacity-55"
        />
      </form>
    </div>
  );
}

export function App() {
  if (window.location.pathname === "/" || window.location.pathname === "") {
    return <Landing />;
  }
  return <SearchPage />;
}

function SearchPage() {
  const [params, setParams] = useQueryStates(searchParsers, {
    clearOnDefault: true,
    history: "replace",
  });
  const { q: query } = params;

  const debouncedQuery = useDebounced(query, 300);
  const { source: sourceFilter, searchTerm: trimmedQuery } = parseSourceFilter(debouncedQuery);

  const [theme, setTheme] = useState<Theme | null>(
    () => localStorage.getItem("theme") as Theme | null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("query-empty", !query);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const nixQuery = useQuery({
    queryKey: ["nix", trimmedQuery],
    queryFn: () =>
      searchNix(trimmedQuery, false, {
        package: true,
        option: true,
        service: true,
      }),
    enabled: trimmedQuery.length > 0 && (sourceFilter === "all" || sourceFilter === "nix"),
  });

  const brewQuery = useQuery({
    queryKey: ["brew", trimmedQuery],
    queryFn: () => searchBrew(trimmedQuery, false),
    enabled: trimmedQuery.length > 0 && (sourceFilter === "all" || sourceFilter === "brew"),
  });

  const appStoreQuery = useQuery({
    queryKey: ["appStore", trimmedQuery],
    queryFn: () => searchAppStore(trimmedQuery),
    enabled: trimmedQuery.length > 0 && (sourceFilter === "all" || sourceFilter === "mas"),
  });

  const nixData = sourceFilter === "all" || sourceFilter === "nix" ? nixQuery.data : undefined;
  const brewData = sourceFilter === "all" || sourceFilter === "brew" ? brewQuery.data : undefined;
  const appStoreData =
    sourceFilter === "all" || sourceFilter === "mas" ? appStoreQuery.data : undefined;

  const nixLoading =
    (sourceFilter === "all" || sourceFilter === "nix") && nixQuery.isFetching;
  const brewLoading =
    (sourceFilter === "all" || sourceFilter === "brew") && brewQuery.isFetching;
  const appStoreLoading =
    (sourceFilter === "all" || sourceFilter === "mas") && appStoreQuery.isFetching;

  const allEnabledStillPending =
    (nixLoading && nixData === undefined)
    && (brewLoading && brewData === undefined)
    && (appStoreLoading && appStoreData === undefined)
    && (nixLoading || brewLoading || appStoreLoading);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setParams({ q: e.target.value });
  };

  const toggleTheme = () => {
    const cur = effectiveTheme(theme);
    const next: Theme = cur === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    setTheme(next);
  };

  const cur = effectiveTheme(theme);
  const themeIconLabel = cur === "dark" ? "☀︎" : "☽";
  const themeIconTitle =
    cur === "dark" ? "Switch to light mode" : "Switch to dark mode";

  const renderResults = () => {
    if (!trimmedQuery) {
      return <p className={statusMsgClass}>Start typing to search packages</p>;
    }

    if (allEnabledStillPending) {
      return <p className={statusMsgClass}>Searching…</p>;
    }

    const parts: ReactNode[] = [];

    if (nixData !== undefined) {
      if (nixData.length === 0) {
        parts.push(
          <p key="nix-none" className={sectionLabelClass}>
            No Nix results found for{" "}
            <em className="not-italic text-fg-strong">{trimmedQuery}</em>
          </p>,
        );
      } else {
        parts.push(
          <EcosystemSection key="nix" icon="/nix-icon.svg" label="Nix">
            {nixData.map((p) => (
              <NixCard key={`${p.kind}:${p.name}`} pkg={p} />
            ))}
          </EcosystemSection>,
        );
      }
    }

    if (brewLoading && brewData === undefined) {
      parts.push(
        <p key="brew-loading" className={statusMsgInlineClass}>
          Loading Homebrew data…
        </p>,
      );
    } else if (brewData !== undefined) {
      if (brewData.length > 0) {
        parts.push(
          <EcosystemSection key="brew" icon="/brew-icon.svg" label="Homebrew">
            {brewData.map((p) => (
              <BrewCard key={`${p.brewType}:${p.token}`} pkg={p} />
            ))}
          </EcosystemSection>,
        );
      } else if (nixData?.length === 0 && !appStoreData?.length) {
        parts.push(
          <p key="brew-none" className={sectionLabelClass}>
            No Homebrew packages found either.
          </p>,
        );
      }
    }

    if (appStoreLoading && appStoreData === undefined) {
      parts.push(
        <p key="as-loading" className={statusMsgInlineClass}>
          Searching App Store…
        </p>,
      );
    } else if (appStoreData !== undefined && appStoreData.length > 0) {
      parts.push(
        <EcosystemSection
          key="appstore"
          icon="/app-store-icon.svg"
          label="App Store"
        >
          {appStoreData.map((p) => (
            <AppStoreCard key={String(p.trackId)} pkg={p} />
          ))}
        </EcosystemSection>,
      );
    }

    return parts.length > 0 ? (
      <>{parts}</>
    ) : (
      <p className={statusMsgClass}>No results found.</p>
    );
  };

  return (
    <div className="max-w-[1340px] mx-auto px-4 min-h-svh">
      <nav className="sticky top-0 z-20 bg-bg-base flex items-center gap-2.5 py-2.5 border-b border-line">
        <a
          className="text-sm font-bold tracking-[-0.2px] text-fg-strong no-underline font-mono shrink-0 pr-1 hover:text-accent"
          href="/"
        >
          pkgs.one
        </a>
        <div className="flex-1">
          <SearchInput
            inputRef={inputRef}
            value={query}
            onChange={onInputChange}
            className="w-full px-3.5 py-2 text-sm font-sans border border-line rounded-lg bg-bg-base text-fg-strong outline-none transition-colors duration-150 appearance-none focus:border-accent placeholder:text-fg placeholder:opacity-55"
          />
        </div>
        <button
          type="button"
          title={themeIconTitle}
          onClick={toggleTheme}
          className="shrink-0 bg-transparent border border-line rounded-md text-fg cursor-pointer text-base leading-none px-2 py-[5px] transition-[border-color,color] duration-150 hover:border-line-accent hover:text-accent"
        >
          {themeIconLabel}
        </button>
      </nav>

      <main className="js-when-query flex flex-col gap-3.5 mt-2 pb-16">
        {renderResults()}
      </main>
    </div>
  );
}
