/**
 * Review Context Enricher
 * Extensible pipeline for injecting additional context before AI analysis
 */

export interface EnrichmentSource {
  id: string;
  name: string;
  enrich(context: EnrichmentContext): Promise<EnrichmentResult | null>;
}

export interface EnrichmentContext {
  owner: string;
  repo: string;
  pullNumber: number;
  diff: string;
  changedFiles: string[];
}

export interface EnrichmentResult {
  sourceId: string;
  label: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export class ReviewContextEnricher {
  private sources: EnrichmentSource[] = [];

  register(source: EnrichmentSource): void {
    this.sources.push(source);
  }

  async enrich(context: EnrichmentContext): Promise<EnrichmentResult[]> {
    const results = await Promise.allSettled(
      this.sources.map((s) => s.enrich(context)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<EnrichmentResult | null> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value!);
  }

  formatForPrompt(results: EnrichmentResult[]): string {
    if (results.length === 0) return "";
    return results
      .map((r) => `\n---\n## Additional Context: ${r.label}\n${r.content}`)
      .join("\n");
  }
}
