export interface DeploymentFeatures {
  feed: boolean;
  imessage: boolean;
  whatsapp: boolean;
}

function readFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function getDeploymentFeatures(
  env: Record<string, string | undefined> = process.env,
): DeploymentFeatures {
  return {
    feed: readFlag(env.NEXT_PUBLIC_ENABLE_FEED),
    imessage: readFlag(env.NEXT_PUBLIC_ENABLE_IMESSAGE),
    whatsapp: readFlag(env.NEXT_PUBLIC_ENABLE_WHATSAPP),
  };
}

export const deploymentFeatures = getDeploymentFeatures();
