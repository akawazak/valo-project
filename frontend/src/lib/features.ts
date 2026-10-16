import { isAndroidRuntime } from "./platform";

/**
 * Release flags for features that rely on undocumented Riot endpoints awaiting
 * confirmation (docs/ANDROID_SECURITY_AND_RIOT_API_PLAN.md). Desktop only for now.
 */
export const FEATURE_FLAGS = {
    accolades: () => !isAndroidRuntime(),
};
