import {
  AlertTriangle as LucideAlertTriangle,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  BarChart3 as LucideBarChart3,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  ChevronLeft as LucideChevronLeft,
  CircleAlert as LucideCircleAlert,
  CircleHelp as LucideCircleHelp,
  CircleUser as LucideCircleUser,
  Copy as LucideCopy,
  Cpu as LucideCpu,
  Download as LucideDownload,
  FileText as LucideFileText,
  FileUp as LucideFileUp,
  Info as LucideInfo,
  Layers as LucideLayers,
  Library as LucideLibrary,
  LogOut as LucideLogOut,
  Menu as LucideMenu,
  MessageSquare as LucideMessageSquare,
  MessageSquareText as LucideMessageSquareText,
  Monitor as LucideMonitor,
  Moon as LucideMoon,
  Plus as LucidePlus,
  RotateCcw as LucideRotateCcw,
  Search as LucideSearch,
  SearchX as LucideSearchX,
  ShieldAlert as LucideShieldAlert,
  Square as LucideSquare,
  Sun as LucideSun,
  Trash2 as LucideTrash2,
  TriangleAlert as LucideTriangleAlert,
  Upload as LucideUpload,
  UserMinus as LucideUserMinus,
  UserRoundCog as LucideUserRoundCog,
  UsersRound as LucideUsersRound,
  X as LucideX,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * Every icon of the UI. Module UIs and the shell import their icons from
 * `@knowcel/ui`, never from `lucide-react` (biome.json forbids it), so that
 * the icons can be replaced in one place: a deployment's branding file can swap
 * an icon for its own image (docs/operations/branding.md).
 *
 * An icon's name is the kebab-case of its export name (`CheckCircle2` is
 * `check-circle-2`), the name the branding file uses.
 */

/** The props the UI passes to an icon. */
export interface IconProps {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

/** The type of an icon, for components that take one as a prop. */
export type IconComponent = (props: IconProps) => ReactNode;

type Source = (props: IconProps) => ReactNode;

const registry = new Map<string, Source>();
let overrides: Record<string, string> = {};

/** The branded image of an icon as a mask: it takes the text colour and the size from the class. */
function maskStyle(url: string): CSSProperties {
  const image = `url("${url.replace(/["\\]/g, "")}")`;
  return {
    backgroundColor: "currentColor",
    maskImage: image,
    WebkitMaskImage: image,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    maskSize: "contain",
    WebkitMaskSize: "contain",
  };
}

/** An icon that renders the deployment's image for `name` when the branding has one, else `Component`. */
function icon(name: string, Component: Source): IconComponent {
  registry.set(name, Component);
  const Icon: IconComponent = (props) => {
    const url = overrides[name];
    if (!url) return <Component {...props} />;
    return (
      <span
        aria-hidden={props["aria-hidden"]}
        className={cn("inline-block shrink-0", props.className)}
        style={maskStyle(url)}
      />
    );
  };
  return Icon;
}

/** The names of the icons a branding file can replace. */
export function iconNames(): string[] {
  return [...registry.keys()];
}

/**
 * Replaces icons by images (name to URL); names that are not an icon are ignored.
 * Icons render the replacement from then on; `undefined` restores them all.
 */
export function setIconOverrides(urls: Record<string, string> | undefined) {
  overrides = Object.fromEntries(Object.entries(urls ?? {}).filter(([name]) => registry.has(name)));
}

export const AlertTriangle = icon("alert-triangle", LucideAlertTriangle);
export const ArrowLeft = icon("arrow-left", LucideArrowLeft);
export const ArrowRight = icon("arrow-right", LucideArrowRight);
export const ArrowUp = icon("arrow-up", LucideArrowUp);
export const BarChart3 = icon("bar-chart-3", LucideBarChart3);
export const Check = icon("check", LucideCheck);
export const CheckCircle2 = icon("check-circle-2", LucideCheckCircle2);
export const ChevronLeft = icon("chevron-left", LucideChevronLeft);
export const CircleAlert = icon("circle-alert", LucideCircleAlert);
export const CircleHelp = icon("circle-help", LucideCircleHelp);
export const CircleUser = icon("circle-user", LucideCircleUser);
export const Copy = icon("copy", LucideCopy);
export const Cpu = icon("cpu", LucideCpu);
export const Download = icon("download", LucideDownload);
export const FileText = icon("file-text", LucideFileText);
export const FileUp = icon("file-up", LucideFileUp);
export const Info = icon("info", LucideInfo);
export const Layers = icon("layers", LucideLayers);
export const Library = icon("library", LucideLibrary);
export const LogOut = icon("log-out", LucideLogOut);
export const Menu = icon("menu", LucideMenu);
export const MessageSquare = icon("message-square", LucideMessageSquare);
export const MessageSquareText = icon("message-square-text", LucideMessageSquareText);
export const Monitor = icon("monitor", LucideMonitor);
export const Moon = icon("moon", LucideMoon);
export const Plus = icon("plus", LucidePlus);
export const RotateCcw = icon("rotate-ccw", LucideRotateCcw);
export const Search = icon("search", LucideSearch);
export const SearchX = icon("search-x", LucideSearchX);
export const ShieldAlert = icon("shield-alert", LucideShieldAlert);
export const Square = icon("square", LucideSquare);
export const Sun = icon("sun", LucideSun);
export const Trash2 = icon("trash-2", LucideTrash2);
export const TriangleAlert = icon("triangle-alert", LucideTriangleAlert);
export const Upload = icon("upload", LucideUpload);
export const UserMinus = icon("user-minus", LucideUserMinus);
export const UserRoundCog = icon("user-round-cog", LucideUserRoundCog);
export const UsersRound = icon("users-round", LucideUsersRound);
export const X = icon("x", LucideX);
