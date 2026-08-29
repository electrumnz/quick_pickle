/**
 * The admin's shared vocabulary.
 *
 * Import page furniture and layout pieces from `@/components/admin` so every
 * destination looks like the same product. Anything that reads the database
 * lives in `@/components/admin/data/*` and is deliberately NOT re-exported
 * here: those modules are `server-only`, and a barrel that mixed them with
 * components would make a client import fail with a confusing error.
 *
 * Typical page:
 *
 * ```tsx
 * import {
 *   Card, CardBody, NotBuiltYet, PageHeader, PageSections, Section,
 * } from "@/components/admin";
 *
 * export default function Page() {
 *   return (
 *     <>
 *       <PageHeader title="Money" lede="What came in, and what is owed." />
 *       <PageSections>
 *         <Section id="takings" title="Money in">…</Section>
 *       </PageSections>
 *     </>
 *   );
 * }
 * ```
 *
 * For a long reference page, add `<PageNav>` with one entry per `Section` id.
 */

export {
  ActionLink,
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageNav,
  PageSections,
  Section,
} from "./ui/page";

export {
  Avatar,
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  Dot,
  EmptyState,
  Meter,
  Prose,
  Row,
  Rows,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "./ui/primitives";

export { TakingsStrip } from "./ui/bars";
export { FilterNotice, SearchForm } from "./ui/search-form";

export {
  IconApproval,
  IconAlert,
  IconBrand,
  IconChevron,
  IconClose,
  IconCustomers,
  IconMenu,
  IconMoney,
  IconMoon,
  IconOrders,
  IconSearch,
  IconSettings,
  IconSocial,
  IconStock,
  IconSun,
  IconTeam,
  IconToday,
  type IconProps,
} from "./ui/icons";

export {
  DESTINATIONS,
  destinationById,
  destinationFor,
  type Destination,
} from "./shell/destinations";
