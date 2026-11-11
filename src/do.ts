import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { partdSchemaHints, partdTables } from "./lib/staging";

export class PartdDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    // Canonical scalar evidence must reach the inherited raw payload store.
    return value === null || typeof value !== "object" ? value : partdTables(value);
  }

  protected getSchemaHints(value: unknown) {
    return partdSchemaHints(value);
  }
}
