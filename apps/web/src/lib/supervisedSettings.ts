import { queryOptions } from "@tanstack/react-query";

import { readNativeApi } from "~/nativeApi";

export const supervisedSettingsQueryKeys = {
  all: ["supervised-settings"] as const,
  snapshot: () => [...supervisedSettingsQueryKeys.all, "snapshot"] as const,
};

export const supervisedSettingsQueryOptions = () =>
  queryOptions({
    queryKey: supervisedSettingsQueryKeys.snapshot(),
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) throw new Error("Synara server unavailable.");
      return api.orchestration.getSupervisedSettings();
    },
    refetchInterval: 5_000,
    staleTime: 1_000,
  });
