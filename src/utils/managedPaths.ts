export interface ManagedPathConfig {
  svnPath: string;
  xmlPath: string;
  backendPath: string;
  frontendPath: string;
}

export function joinManagedPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => part.replace(/\\/g, "/").replace(/\/+$/g, ""))
    .join("/")
    .replace(/\/+/g, "/");
}

export function applyManagedMessagePaths(config: ManagedPathConfig) {
  const messagePath = config.svnPath.trim();
  if (!messagePath) return;
  config.xmlPath = joinManagedPath(messagePath, "xml");
  config.backendPath = joinManagedPath(messagePath, "java");
  config.frontendPath = joinManagedPath(messagePath, "c");
}

