import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

/**
 * Runtime guard: returns true if value is a non-null, non-array object
 * and narrows the type to Record<string, unknown>.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPrescriberFields(obj: Record<string, unknown>): boolean {
    return "Prscrbr_NPI" in obj || "Prscrbr_Last_Org_Name" in obj;
}

function hasSpendingFields(obj: Record<string, unknown>): boolean {
    return "Mftr_Name" in obj || "Tot_Spndng" in obj || "Avg_Spnd_Per_Dsg_Unt_Wghtd" in obj;
}

function hasDrugNameFields(obj: Record<string, unknown>): boolean {
    return "Brnd_Name" in obj || "Gnrc_Name" in obj;
}

export class PartdDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample: unknown = data[0];
            if (isRecord(sample)) {
                // Part D Prescriber data — has NPI and drug fields
                if (hasPrescriberFields(sample)) {
                    return {
                        tableName: "prescriber_data",
                        indexes: [
                            "Prscrbr_NPI",
                            "Prscrbr_Last_Org_Name",
                            "Prscrbr_State_Abrvtn",
                            "Prscrbr_Type",
                            "Brnd_Name",
                            "Gnrc_Name",
                        ],
                    };
                }

                // Part D Drug Spending data — has manufacturer and spending fields
                if (hasSpendingFields(sample)) {
                    return {
                        tableName: "drug_spending",
                        indexes: [
                            "Brnd_Name",
                            "Gnrc_Name",
                            "Mftr_Name",
                        ],
                    };
                }

                // Generic CMS data with brand/generic drug names
                if (hasDrugNameFields(sample)) {
                    return {
                        tableName: "cms_data",
                        indexes: ["Brnd_Name", "Gnrc_Name"],
                    };
                }
            }
        }

        // Single object with prescriber info
        if (!Array.isArray(data) && isRecord(data)) {
            if (typeof data.Prscrbr_NPI === "string" && data.Prscrbr_NPI) {
                return {
                    tableName: "prescriber_data",
                    indexes: ["Prscrbr_NPI", "Prscrbr_Last_Org_Name", "Brnd_Name", "Gnrc_Name"],
                };
            }
        }

        return undefined;
    }
}
