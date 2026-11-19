import type { LucideIcon } from "lucide-react";

/**
 * Every icon of the UI. Module UIs and the shell import their icons from
 * `@knowcel/ui`, never from `lucide-react` (biome.json forbids it), so that
 * the icons can be replaced in one place.
 */

/** The type of an icon, for components that take one as a prop. */
export type IconComponent = LucideIcon;

export {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  CircleHelp,
  CircleUser,
  Copy,
  Cpu,
  Download,
  FileText,
  FileUp,
  Info,
  Layers,
  Library,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquareText,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  ShieldAlert,
  Square,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  UserMinus,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
