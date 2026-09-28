"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStorageProfile,
  getStorageProfile,
  getStorageReadiness,
  listStorageProfiles,
  rotateStorageCredentials,
  runBrowserUploadProbe,
  runStorageAction,
  updateStorageProfile,
} from "./api";
import type { StorageProfileDraftInput } from "./types";

const listKey = ["admin", "storage-profiles"] as const;
const detailKey = (id: string) => [...listKey, id] as const;
const readinessKey = (id: string) => [...detailKey(id), "readiness"] as const;

export function useStorageProfiles() {
  return useQuery({
    queryKey: listKey,
    queryFn: listStorageProfiles,
    retry: false,
  });
}
export function useStorageProfile(id: string | null) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    queryFn: () => getStorageProfile(id as string),
    enabled: Boolean(id),
    retry: false,
  });
}
export function useStorageReadiness(id: string | null) {
  return useQuery({
    queryKey: readinessKey(id ?? ""),
    queryFn: () => getStorageReadiness(id as string),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useStorageProfileActions() {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: listKey });
    await client.invalidateQueries({ queryKey: ["admin", "settings"] });
  };
  return {
    create: useMutation({
      mutationFn: createStorageProfile,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        input,
      }: {
        id: string;
        input: Partial<StorageProfileDraftInput>;
      }) => updateStorageProfile(id, input),
      onSuccess: refresh,
    }),
    rotate: useMutation({
      mutationFn: ({
        id,
        b2KeyId,
        b2ApplicationKey,
      }: {
        id: string;
        b2KeyId: string;
        b2ApplicationKey: string;
      }) => rotateStorageCredentials(id, { b2KeyId, b2ApplicationKey }),
      onSuccess: refresh,
    }),
    operation: useMutation({
      mutationFn: ({
        id,
        action,
      }: {
        id: string;
        action: Parameters<typeof runStorageAction>[1];
      }) => runStorageAction(id, action),
      onSuccess: refresh,
    }),
    browserProbe: useMutation({
      mutationFn: runBrowserUploadProbe,
      onSuccess: refresh,
    }),
  };
}
