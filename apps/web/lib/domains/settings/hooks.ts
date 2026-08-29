"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProductSettings, updateProductSettings } from "./api";

const settingsKey = ["admin", "settings"] as const;

export function useProductSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: getProductSettings,
    retry: false,
  });
}

export function useUpdateProductSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductSettings,
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings),
  });
}
