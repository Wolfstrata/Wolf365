import type { ConnectorType } from "@prisma/client";
import type { ConnectorDefinition } from "@/connectors/types";
import { quickbooksConnector } from "@/connectors/quickbooks";
import { tdSynnexConnector } from "@/connectors/tdsynnex";
import { huduConnector } from "@/connectors/hudu";
import { superOpsConnector } from "@/connectors/superops";
import { salesforceConnector } from "@/connectors/salesforce";

/**
 * The registry is heterogeneous: each connector keeps its own typed config and
 * secrets generics, but they are erased here so they can live in one map. The
 * generics are only used internally by each connector, so this erasure is safe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConnectorDefinition = ConnectorDefinition<any, any>;

/**
 * Central registry of connector definitions. The admin UI and runtime resolve
 * connectors by type through here, so adding a connector is a one-line change.
 */
const REGISTRY: Record<ConnectorType, AnyConnectorDefinition> = {
  TD_SYNNEX_STELLR: tdSynnexConnector,
  QUICKBOOKS_ONLINE: quickbooksConnector,
  HUDU: huduConnector,
  SUPEROPS: superOpsConnector,
  SALESFORCE: salesforceConnector,
};

export function getConnectorDefinition(
  type: ConnectorType,
): AnyConnectorDefinition {
  const def = REGISTRY[type];
  if (!def) throw new Error(`Unknown connector type: ${type}`);
  return def;
}

export function listConnectorDefinitions(): AnyConnectorDefinition[] {
  return Object.values(REGISTRY);
}
