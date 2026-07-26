export type BuilderName = "common" | "claude" | "codex";

export interface Artifact {
  builder: BuilderName;
  /** POSIX-style path relative to the workspace root. */
  path: string;
  content: string;
  mode?: number;
}

export interface Degradation {
  builder: BuilderName;
  capability: string;
  resource: string;
  reason: string;
}

export interface PreparedProjection {
  artifacts: Artifact[];
  degradations: Degradation[];
}
