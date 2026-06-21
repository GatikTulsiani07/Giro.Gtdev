export interface ArchitectureReportMetadata {
    title: string;
    generatedBy: "giro";
    format: "markdown";
    version: string;
  }
  
  export const DEFAULT_ARCHITECTURE_REPORT_METADATA: ArchitectureReportMetadata = {
    title: "Giro Architecture Report",
    generatedBy: "giro",
    format: "markdown",
    version: "1.0.0",
  };