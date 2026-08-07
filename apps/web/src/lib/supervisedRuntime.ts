import { queryOptions } from "@tanstack/react-query";

import { readNativeApi } from "~/nativeApi";

export const supervisedRuntimeQueryKeys = {
  all: ["supervised-runtime"] as const,
  snapshot: () => [...supervisedRuntimeQueryKeys.all, "snapshot"] as const,
};

export const supervisedRuntimeQueryOptions = () =>
  queryOptions({
    queryKey: supervisedRuntimeQueryKeys.snapshot(),
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) throw new Error("Synara server unavailable.");
      return api.orchestration.getSupervisedRuntime({ includeDisabled: true, limit: 500 });
    },
    refetchInterval: 5_000,
    staleTime: 1_000,
  });
